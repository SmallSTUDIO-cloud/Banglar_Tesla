import { defineConfig } from 'vite';

const ghPages =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GITHUB_PAGES === 'true';

export default defineConfig({
  base: ghPages ? '/Banglar_Tesla/' : './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The Arena preview proxy serves the app from a different host name.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2200,
    sourcemap: false,
  },
});
