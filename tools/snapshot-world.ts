/**
 * Print the generated-world snapshot as JSON (CLI).
 *
 * Run: npx vite-node tools/snapshot-world.ts > world.json
 */
import { generateWorldSnapshot } from './worldSnapshotGenerate';
import { worldDigest } from './worldSnapshot';

const snapshot = await generateWorldSnapshot();
console.error(`[world] ${snapshot.counts.buildings} buildings, digest ${worldDigest(snapshot)}`);
console.log(JSON.stringify(snapshot, null, 1));
