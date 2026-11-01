/**
 * Display the accepted release as the v0.6.3 web baseline. The Android binary
 * and its build metadata retain the exact v0.6.3-test.1 identity published on
 * GitHub; only the in-game version label omits the test-build suffix.
 */

import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version.replace(/-test\.\d+$/, '');
