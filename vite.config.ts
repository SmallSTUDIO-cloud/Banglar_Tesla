import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * Short commit SHA of the checkout being built. The Android wrapper cannot carry
 * a query string, so this is the only way a build can prove which source it came
 * from — without it, two different APKs both display "v0.6.7" and are
 * indistinguishable on a phone.
 */
function buildStamp(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const ghPages =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GITHUB_PAGES === 'true';

export default defineConfig({
  define: {
    __BT_BUILD__: JSON.stringify(buildStamp()),
  },
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
