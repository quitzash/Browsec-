import { execFile, spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';

const execFileAsync = promisify(execFile);

/**
 * Cloudflare WARP, run entirely in userspace.
 *
 *  - wgcf       registers a free WARP device and produces a WireGuard profile.
 *  - wireproxy  runs that WireGuard tunnel inside a normal process and exposes it as a local HTTP proxy.
 *
 * No root, no system service and no TUN device are needed, so the app can start and stop it itself.
 * The local proxy listens on 127.0.0.1 only. The account key stays in the data directory (mode 0600).
 */

const WGCF_VERSION = '2.3.0';
const WIREPROXY_VERSION = '1.1.3';

// Hashes for the build most people run (linux/amd64), checked into the code so a swapped download is rejected even
// if the release page is tampered with. Other platforms are verified against the release's published checksums.txt.
const PINNED_SHA256: Record<string, string> = {
  [`wgcf_${WGCF_VERSION}_linux_amd64`]: '01614e38c0eb5f3405232e71cfaf02d64d4809e4988ad8f5a8071af16d193405',
  'wireproxy_linux_amd64.tar.gz': 'e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c',
};

export interface WarpStatus {
  supported: boolean;
  reason?: string;
  installed: boolean;
  registered: boolean;
  running: boolean;
  url?: string;
  startedAt?: number;
  step?: string;
  lastError?: string;
}

export interface WarpConnection {
  url: string;
  trace: Record<string, string>;
}

const OS_NAME: Record<string, string> = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
const ARCH_NAME: Record<string, string> = { x64: 'amd64', arm64: 'arm64' };
const isWindows = process.platform === 'win32';

export function dataDir(): string {
  return process.env.APEX_DATA_DIR || path.join(os.homedir(), '.apex-browser');
}
const binDir = () => path.join(dataDir(), 'bin');
const warpDir = () => path.join(dataDir(), 'warp');
const exe = (name: string) => (isWindows ? `${name}.exe` : name);

function platformSupport(): { ok: boolean; reason?: string; os?: string; arch?: string } {
  const osName = OS_NAME[process.platform];
  const arch = ARCH_NAME[process.arch];
  if (!osName || !arch) return { ok: false, reason: `Cloudflare WARP helpers are not available for ${process.platform}/${process.arch}.` };
  if (process.env.VERCEL) return { ok: false, reason: 'WARP needs a machine where the server can run a helper program, which serverless hosting cannot do.' };
  return { ok: true, os: osName, arch };
}

let child: ChildProcess | null = null;
let proxyUrl = '';
let startedAt = 0;
let step = '';
let lastError = '';
let connecting: Promise<WarpConnection> | null = null;
let exitHandler: ((reason: string) => void) | null = null;

/** Called when the tunnel process dies on its own, so the app can stop routing traffic into a dead port. */
export function setWarpExitHandler(handler: (reason: string) => void): void {
  exitHandler = handler;
}

export function warpStatus(): WarpStatus {
  const support = platformSupport();
  const installed = fs.existsSync(path.join(binDir(), exe('wgcf'))) && fs.existsSync(path.join(binDir(), exe('wireproxy')));
  const registered = fs.existsSync(path.join(warpDir(), 'wgcf-profile.conf'));
  const running = !!child && child.exitCode === null && !child.killed;
  return {
    supported: support.ok,
    reason: support.reason,
    installed,
    registered,
    running,
    url: running ? proxyUrl : undefined,
    startedAt: running ? startedAt : undefined,
    step: connecting ? step : undefined,
    lastError: lastError || undefined,
  };
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

const directAgent = new Agent();

async function download(url: string, timeoutMs = 90000): Promise<Buffer> {
  const res = await undiciFetch(url, { dispatcher: directAgent, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > 80 * 1024 * 1024) throw new Error('Download was unexpectedly large');
  return body;
}

const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');

async function expectedHash(assetName: string, checksumsUrl: string): Promise<string> {
  if (PINNED_SHA256[assetName]) return PINNED_SHA256[assetName];
  const text = (await download(checksumsUrl, 30000)).toString('utf8');
  for (const line of text.split(/\r?\n/)) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === assetName && /^[a-f0-9]{64}$/i.test(hash)) return hash.toLowerCase();
  }
  throw new Error(`No published checksum for ${assetName}`);
}

async function ensureBinaries(): Promise<{ wgcf: string; wireproxy: string }> {
  const support = platformSupport();
  if (!support.ok) throw new Error(support.reason);
  const dir = binDir();
  ensureDir(dir);
  const wgcfPath = path.join(dir, exe('wgcf'));
  const wireproxyPath = path.join(dir, exe('wireproxy'));
  const markerPath = path.join(dir, 'versions.json');
  const marker = JSON.stringify({ wgcf: WGCF_VERSION, wireproxy: WIREPROXY_VERSION });
  if (fs.existsSync(wgcfPath) && fs.existsSync(wireproxyPath) && fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf8') === marker) {
    return { wgcf: wgcfPath, wireproxy: wireproxyPath };
  }

  step = 'Downloading the WARP helper programs…';
  const wgcfAsset = `wgcf_${WGCF_VERSION}_${support.os}_${support.arch}${isWindows ? '.exe' : ''}`;
  const wgcfBase = `https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}`;
  const wgcfBytes = await download(`${wgcfBase}/${wgcfAsset}`);
  if (sha256(wgcfBytes) !== (await expectedHash(wgcfAsset, `${wgcfBase}/checksums.txt`))) {
    throw new Error('The downloaded wgcf did not match its published checksum, so it was discarded.');
  }
  fs.writeFileSync(wgcfPath, wgcfBytes, { mode: 0o755 });

  const wpAsset = `wireproxy_${support.os}_${support.arch}.tar.gz`;
  const wpBase = `https://github.com/whyvl/wireproxy/releases/download/v${WIREPROXY_VERSION}`;
  const wpBytes = await download(`${wpBase}/${wpAsset}`);
  if (sha256(wpBytes) !== (await expectedHash(wpAsset, `${wpBase}/checksums.txt`))) {
    throw new Error('The downloaded wireproxy did not match its published checksum, so it was discarded.');
  }
  const archive = path.join(dir, wpAsset);
  fs.writeFileSync(archive, wpBytes, { mode: 0o600 });
  try {
    await execFileAsync('tar', ['-xzf', archive, '-C', dir, exe('wireproxy')], { timeout: 30000 });
  } finally {
    fs.rmSync(archive, { force: true });
  }
  fs.chmodSync(wireproxyPath, 0o755);
  fs.writeFileSync(markerPath, marker);
  return { wgcf: wgcfPath, wireproxy: wireproxyPath };
}

async function ensureAccount(wgcf: string): Promise<string> {
  const dir = warpDir();
  ensureDir(dir);
  const profile = path.join(dir, 'wgcf-profile.conf');
  if (fs.existsSync(profile) && fs.existsSync(path.join(dir, 'wgcf-account.toml'))) return profile;

  step = 'Registering a free WARP device with Cloudflare…';
  const run = async (args: string[]) => {
    try {
      await execFileAsync(wgcf, args, { cwd: dir, timeout: 60000 });
    } catch (err: any) {
      const detail = String(err?.stderr || err?.stdout || err?.message || '').trim().split('\n').slice(-2).join(' ');
      throw new Error(`WARP registration failed: ${detail || 'unknown error'}`);
    }
  };
  // Registering a WARP device accepts Cloudflare's terms of service; the UI tells the user before this runs.
  await run(['register', '--accept-tos']);
  await run(['generate']);
  for (const file of ['wgcf-account.toml', 'wgcf-profile.conf']) {
    try {
      fs.chmodSync(path.join(dir, file), 0o600);
    } catch {
      // best effort on platforms without POSIX modes
    }
  }
  return profile;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

const pidFile = () => path.join(warpDir(), 'wireproxy.pid');

/** A previous server may have been killed without cleaning up. Stop only a process that really is our wireproxy. */
async function killStale(): Promise<void> {
  try {
    const pid = Number(fs.readFileSync(pidFile(), 'utf8').trim());
    if (!pid || isWindows) return;
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 5000 });
    if (stdout.includes('wireproxy')) process.kill(pid, 'SIGTERM');
  } catch {
    // no pid file or process already gone
  } finally {
    fs.rmSync(pidFile(), { force: true });
  }
}

async function readTrace(url: string, timeoutMs: number): Promise<Record<string, string> | null> {
  const agent = new ProxyAgent({ uri: url, connectTimeout: timeoutMs });
  try {
    const res = await undiciFetch('https://www.cloudflare.com/cdn-cgi/trace', { dispatcher: agent, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const trace: Record<string, string> = {};
    for (const line of (await res.text()).split('\n')) {
      const index = line.indexOf('=');
      if (index > 0) trace[line.slice(0, index)] = line.slice(index + 1);
    }
    return trace.warp === 'on' || trace.warp === 'plus' ? trace : null;
  } catch {
    return null;
  } finally {
    agent.destroy().catch(() => {});
  }
}

function logTail(): string {
  try {
    return fs.readFileSync(path.join(warpDir(), 'wireproxy.log'), 'utf8').trim().split('\n').slice(-3).join(' | ');
  } catch {
    return '';
  }
}

async function start(wireproxy: string, profile: string): Promise<WarpConnection> {
  step = 'Starting the tunnel…';
  await killStale();
  const port = await freePort();
  const wgConfig = fs.readFileSync(profile, 'utf8');
  const confPath = path.join(warpDir(), 'wireproxy.conf');
  fs.writeFileSync(confPath, `${wgConfig.trim()}\n\n[http]\nBindAddress = 127.0.0.1:${port}\n`, { mode: 0o600 });

  const logFd = fs.openSync(path.join(warpDir(), 'wireproxy.log'), 'w', 0o600);
  const proc = spawn(wireproxy, ['-c', confPath], { stdio: ['ignore', logFd, logFd], windowsHide: true });
  fs.closeSync(logFd);
  child = proc;
  proxyUrl = `http://127.0.0.1:${port}`;
  startedAt = Date.now();
  if (proc.pid) fs.writeFileSync(pidFile(), String(proc.pid), { mode: 0o600 });

  proc.on('exit', (code, signal) => {
    if (child !== proc) return;
    child = null;
    proxyUrl = '';
    fs.rmSync(pidFile(), { force: true });
    if (signal !== 'SIGTERM') {
      lastError = `The WARP tunnel stopped unexpectedly (${signal || `code ${code}`}).`;
      exitHandler?.(lastError);
    }
  });

  step = 'Checking the connection…';
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child !== proc) throw new Error(`The WARP tunnel exited while starting. ${logTail()}`.trim());
    const trace = await readTrace(proxyUrl, 5000);
    if (trace) return { url: proxyUrl, trace };
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  await stopWarp();
  throw new Error(`Cloudflare WARP did not come up within 20 seconds. ${logTail()}`.trim());
}

export function connectWarp(): Promise<WarpConnection> {
  if (connecting) return connecting;
  connecting = (async () => {
    lastError = '';
    try {
      if (child && child.exitCode === null && proxyUrl) {
        const trace = await readTrace(proxyUrl, 5000);
        if (trace) return { url: proxyUrl, trace };
        await stopWarp();
      }
      const { wgcf, wireproxy } = await ensureBinaries();
      const profile = await ensureAccount(wgcf);
      return await start(wireproxy, profile);
    } catch (err: any) {
      lastError = err?.message || 'Could not start Cloudflare WARP';
      throw err;
    } finally {
      connecting = null;
      step = '';
    }
  })();
  return connecting;
}

export async function stopWarp(): Promise<void> {
  const proc = child;
  child = null;
  proxyUrl = '';
  if (!proc) return;
  proc.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 2000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  fs.rmSync(pidFile(), { force: true });
}

process.on('exit', () => {
  child?.kill('SIGTERM');
});
