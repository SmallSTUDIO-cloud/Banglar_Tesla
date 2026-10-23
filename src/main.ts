/**
 * Boot: hide the logo splash, build the game, start the loop, register the PWA.
 */

import './styles.css';
import { Game } from './game';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const splash = document.getElementById('boot-splash');
  const skip = document.getElementById('boot-skip');
  if (!canvas) throw new Error('canvas missing');

  let dismissed = false;
  const dismissSplash = (): void => {
    if (dismissed) return;
    dismissed = true;
    splash?.classList.add('hide');
    window.setTimeout(() => splash?.remove(), 700);
  };
  skip?.addEventListener('click', dismissSplash);
  window.setTimeout(dismissSplash, 2600);

  try {
    const game = new Game(canvas);
    const win = window as unknown as {
      __banglarTesla?: Game;
      __banglarTeslaAndroidBack?: () => boolean;
    };
    win.__banglarTesla = game;
    win.__banglarTeslaAndroidBack = () => game.handleBackButton();
    await game.init();
    game.start();
  } catch (err) {
    console.error('[boot] failed', err);
    const msg = document.createElement('div');
    msg.style.cssText =
      'position:fixed;inset:0;display:grid;place-items:center;background:#08110f;color:#f7f0e3;font:16px sans-serif;text-align:center;padding:24px;z-index:200';
    msg.innerHTML =
      '<div><h2 style="margin:0 0 8px">BANGLAR TESLA</h2><p>Could not start the 3D engine on this device/browser.</p><p style="opacity:.7;font-size:13px">WebGL2 is required. Try Chrome or update your browser.</p></div>';
    document.body.append(msg);
  }
}

void boot();

// PWA: offline cache after the first successful visit (production web builds only;
// the native Android APK already serves bundled offline assets from AssetManager).
const isBundledApkHost = window.location.hostname === 'appassets.androidplatform.net';
if ('serviceWorker' in navigator && import.meta.env.PROD && !isBundledApkHost) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', window.location.href).pathname).catch((err) => {
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}
