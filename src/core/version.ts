/**
 * Single source of truth for the in-game app version string, read directly from
 * `package.json` so the menu footer can never drift from the release version.
 */

import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
