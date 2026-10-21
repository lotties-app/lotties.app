// Local-network dev config (not committed): serves the app over HTTPS on all interfaces and proxies /api
// to the API that listens on localhost only. Cert/key paths come from LAN_CERT / LAN_KEY.
import { readFileSync } from 'node:fs';
import { mergeConfig } from 'vitest/config';
import base from './vite.config';

export default mergeConfig(base, {
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    https: {
      key: readFileSync(process.env.LAN_KEY as string),
      cert: readFileSync(process.env.LAN_CERT as string),
    },
    proxy: { '/api': { target: 'http://127.0.0.1:5290', changeOrigin: false } },
  },
});
