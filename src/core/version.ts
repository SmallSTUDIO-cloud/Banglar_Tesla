/** Display the package version in the web game and Android wrapper. */

import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version.replace(/-test\.\d+$/, '');

/**
 * Short commit SHA this bundle was built from (`vite.config.ts`). Two APKs can
 * share `APP_VERSION`, so this is what actually identifies a build on a phone.
 */
export const APP_BUILD: string = __BT_BUILD__;

/** Compact one-line build identity, e.g. `v0.6.7 · 72d259d`. */
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;
