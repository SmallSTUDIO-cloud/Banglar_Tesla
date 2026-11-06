/** Display the package version in the web game and Android wrapper. */

import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version.replace(/-test\.\d+$/, '');
