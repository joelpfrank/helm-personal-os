import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:8787';
export function dashboardTokenFile(env = process.env) {
  const stateDir = typeof env.HELM_STATE_DIR === 'string' ? env.HELM_STATE_DIR.trim() : '';
  if (stateDir) {
    if (!path.isAbsolute(stateDir)) {
      throw new Error(`HELM_STATE_DIR must be an absolute path, got: ${stateDir}`);
    }
    return path.resolve(stateDir, '.dashboard-token');
  }
  return path.resolve(__dirname, '..', '.dashboard-token');
}

const TOKEN_FILE = dashboardTokenFile();
const DEV_TOKEN = fs.existsSync(TOKEN_FILE)
  ? fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  : '';

if (!DEV_TOKEN) {
  console.warn('[vite] .dashboard-token not found — start the server once to generate it, then restart vite.');
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (DEV_TOKEN) proxyReq.setHeader('Authorization', `Bearer ${DEV_TOKEN}`);
          });
        },
      },
    },
  },
});
