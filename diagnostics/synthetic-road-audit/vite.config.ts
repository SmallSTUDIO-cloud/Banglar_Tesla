import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Diagnostic-only Vite config.
 *
 * Root is this folder, so the audit is a completely separate app from the game
 * build: it imports the real `src/world` modules and the real world snapshot
 * tooling, but nothing in `npm run build` or the game bundle references it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  server: {
    host: '0.0.0.0',
    port: 4321,
    strictPort: true,
    // Served through the Arena preview proxy, which uses another host name.
    allowedHosts: true,
    fs: { allow: [path.resolve(here, '../..')] },
  },
  build: { outDir: path.resolve(here, 'out'), emptyOutDir: true },
});
