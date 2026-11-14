/** Build-time identity, injected by vite.config.ts from the git checkout. */
declare const __BT_BUILD__: string;

/**
 * Minimal declaration for the one Node API vite.config.ts uses. The project
 * intentionally does not ship @types/node (browser code must not reach for Node
 * built-ins), so only the used signature is described here.
 */
declare module 'node:child_process' {
  export function execSync(command: string, options: { encoding: 'utf8' }): string;
}
