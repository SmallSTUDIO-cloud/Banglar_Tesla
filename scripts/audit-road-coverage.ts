/**
 * CLI wrapper around `tools/roadCoverage.ts`.
 *
 * The computation lives in `tools/` with no Node dependencies, because the
 * project's browser `tsconfig` type-checks `tests/unit` and therefore anything a
 * unit test imports. This file only reads the extract, hashes it, and prints.
 *
 *   npm run audit:roads            # human-readable report
 *   npm run audit:roads -- --json  # machine-readable
 *
 * Method, figures and their tolerances are documented in `tools/roadCoverage.ts`
 * and pinned by `tests/unit/road-coverage-audit.test.ts`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditRoadCoverage } from '../tools/roadCoverage';

const DATASET_PATH = 'data/mohammadpur/mohammadpur.osm.json';
const DATASET = resolve(process.cwd(), DATASET_PATH);

function main(): void {
  const raw = readFileSync(DATASET);
  const data = JSON.parse(raw.toString('utf8')) as {
    origin?: unknown;
    bounds?: unknown;
    roads?: never[];
  };

  const report = auditRoadCoverage({
    roads: data.roads ?? [],
    datasetMeta: { origin: data.origin, bounds: data.bounds },
    datasetInfo: {
      path: DATASET_PATH,
      sha256: createHash('sha256').update(raw).digest('hex'),
      bytes: raw.length,
    },
    generatedAt: new Date().toISOString(),
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const M = report.projection.metresPerWorldUnit;
  console.log('MOHAMMADPUR ROAD COVERAGE AUDIT');
  console.log(`  generated        ${report.generatedAt}`);
  console.log(`  dataset sha256   ${report.dataset.sha256}`);
  console.log(
    `  playable box     x ${report.box.worldUnits.x0}..${report.box.worldUnits.x1}  z ${report.box.worldUnits.z0}..${report.box.worldUnits.z1} (world units)`,
  );
  console.log(
    `                   x ${report.box.metres.x0.toFixed(0)}..${report.box.metres.x1.toFixed(0)}  z ${report.box.metres.z0.toFixed(0)}..${report.box.metres.z1.toFixed(0)} (metres)`,
  );
  console.log(
    `  OSM drivable     ${report.osm.drivableLengthInBoxWorld.toFixed(0)} u = ${report.osm.drivableLengthInBoxMetres.toFixed(0)} m in-box (${report.osm.drivableWays} ways)`,
  );
  console.log(
    `  game graph       ${report.graph.lengthWorld.toFixed(0)} u = ${report.graph.lengthMetres.toFixed(0)} m (${report.graph.segments} segments, ${report.graph.nodes} nodes)`,
  );
  console.log(`  COVERAGE         ${report.coveragePercent.toFixed(1)} %`);
  console.log(
    `  provenance       ${report.graph.segmentsCitingOsmWay} cite an OSM way, ${report.graph.syntheticSegments} synthetic (${report.graph.syntheticShareOfLength.toFixed(1)} % of length)`,
  );
  const d = report.distances.toNearestDrivableOsmRoadMetres;
  console.log(
    `  midpoint -> nearest drivable OSM road: min ${d.min.toFixed(1)}  median ${d.median.toFixed(1)}  p90 ${d.p90.toFixed(1)}  max ${d.max.toFixed(1)} m`,
  );
  console.log(
    `                   within 25 m: ${d.within25m}/${d.sampleCount}   within 50 m: ${d.within50m}/${d.sampleCount}`,
  );
  console.log(`  (1 world unit = ${M.toFixed(4)} m)`);
}

main();
