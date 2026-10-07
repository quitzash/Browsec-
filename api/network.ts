import { apiApp } from '../server-api.ts';

// Scanning public proxies takes ~15-20s, longer than the default serverless limit.
export const config = { maxDuration: 60 };

export default apiApp;
