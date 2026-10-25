import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

/**
 * Ensures @sparticuz/chromium shared libraries (libnspr4, libnss3, SwiftShader)
 * are extracted on Linux systems that lack system NSS packages.
 */
export function ensureChromiumEnv() {
  const outDir = '/tmp/chromium-libs';
  const libDir = path.join(outDir, 'lib');
  if (!fs.existsSync(path.join(libDir, 'libnspr4.so'))) {
    const binDir = path.join(root, 'node_modules/@sparticuz/chromium/bin');
    fs.mkdirSync(outDir, { recursive: true });
    for (const archive of ['al2023.tar.br', 'swiftshader.tar.br']) {
      const src = path.join(binDir, archive);
      if (!fs.existsSync(src)) continue;
      const tarPath = path.join(outDir, archive.replace(/\.br$/, ''));
      fs.writeFileSync(tarPath, zlib.brotliDecompressSync(fs.readFileSync(src)));
      execFileSync('tar', ['-xf', tarPath, '-C', outDir]);
      fs.unlinkSync(tarPath);
    }
  }
  const existing = process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : '';
  return {
    ...process.env,
    LD_LIBRARY_PATH: `${libDir}:/tmp/tools/probe/libs/lib${existing}`,
  };
}

/**
 * Closes Puppeteer + child preview server without hanging on zombie GPU processes
 * in container environments lacking an init reaper.
 */
export async function teardownHarness(browser, server) {
  try {
    await Promise.race([
      browser?.close?.(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* ignore */
  }
  try {
    browser?.process?.()?.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  try {
    if (server?.pid) {
      try {
        execFileSync('pkill', ['-KILL', '-P', String(server.pid)]);
      } catch {
        /* no child processes */
      }
    }
    server?.kill?.('SIGKILL');
  } catch {
    /* ignore */
  }
}
