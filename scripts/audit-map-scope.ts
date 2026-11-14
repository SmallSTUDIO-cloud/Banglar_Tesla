/**
 * CLI wrapper around `tools/mapScope.ts`.
 *
 *   npm run audit:scope            # human-readable report
 *   npm run audit:scope -- --json  # machine-readable
 *
 * The computation is pure and lives in `tools/`; this file only reads the OSM
 * extract, projects it with the project's own `projectOsm`, and prints.
 *
 * Read `docs/MOHAMMADPUR_MAP_SCOPE.md` before quoting any figure: the boundary
 * ring is provisional and smaller than the administrative thana.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectOsm } from '../src/world/landmarks';
import { ROAD_SEGMENTS } from '../src/world/layout';
import { METERS_PER_WORLD_UNIT } from '../src/world/units';
import { auditMapScope, type ScopeWay } from '../tools/mapScope';

const DATASET_PATH = 'data/mohammadpur/mohammadpur.osm.json';
const DATASET = resolve(process.cwd(), DATASET_PATH);

interface RawPoint {
  lat: number;
  lon: number;
}

interface RawWay {
  id: number;
  highway?: string;
  driveable?: boolean;
  geometry?: RawPoint[];
  nameEn?: string;
  name?: string;
}

function main(): void {
  const raw = readFileSync(DATASET);
  const data = JSON.parse(raw.toString('utf8')) as {
    boundary?: RawPoint[];
    roads?: RawWay[];
    source?: { boundaryWayId?: number; retrievedAt?: string; license?: string };
  };

  if (!data.boundary || data.boundary.length < 4) {
    throw new Error('extract has no boundary ring; cannot audit scope');
  }

  const ring = data.boundary.map((p) => projectOsm(p.lat, p.lon));
  const ways: ScopeWay[] = (data.roads ?? []).map((w) => ({
    id: w.id,
    highway: w.highway,
    driveable: w.driveable,
    // `??` would keep an empty string; the extract mixes empty and missing names.
    nameEn: w.nameEn || w.name,
    polyline: (w.geometry ?? []).map((g) => projectOsm(g.lat, g.lon)),
  }));

  const report = auditMapScope({
    ring,
    ways,
    graphSegments: ROAD_SEGMENTS.map((s) => ({
      id: s.id,
      ax: s.ax,
      az: s.az,
      bx: s.bx,
      bz: s.bz,
      length: s.length,
    })),
    boundarySource: {
      osmWayId: data.source?.boundaryWayId ?? 318722840,
      retrievedAt: data.source?.retrievedAt,
      datasetSha256: createHash('sha256').update(raw).digest('hex'),
      license: data.source?.license ?? 'ODbL-1.0',
    },
    generatedAt: new Date().toISOString(),
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const M = METERS_PER_WORLD_UNIT;
  const b = report.boundary;
  console.log('MOHAMMADPUR MAP SCOPE AUDIT (boundary-clipped)');
  console.log(`  generated        ${report.generatedAt}`);
  console.log(`  dataset sha256   ${b.datasetSha256}`);
  console.log(`  boundary         OSM way ${b.osmWayId}, ${b.vertices} vertices, ${b.license}`);
  console.log(`  area             ${b.areaKm2.toFixed(3)} km2   perimeter ${b.perimeterMetres.toFixed(0)} m`);
  console.log('  PROVISIONAL      published thana areas: ' +
    b.publishedThanaAreaKm2.map((p) => `${p.value} km2`).join(' / '));
  console.log(`                   -> this ring is the mapped core, NOT the full thana`);
  console.log('');
  console.log(`  OSM drivable     ${report.osm.inScopeMetres.toFixed(0)} m in scope ` +
    `(${report.osm.waysTouchingScope}/${report.osm.drivableWays} ways touch it)`);
  console.log(`                   ${report.osm.totalDrivableMetres.toFixed(0)} m across all drivable ways`);
  console.log(`  game graph       ${report.graph.lengthMetres.toFixed(0)} m in ` +
    `${report.graph.segments} segments`);
  console.log(`                   ${report.graph.inScopeMetres.toFixed(0)} m inside the ring ` +
    `(${report.graph.segmentsInScope}/${report.graph.segments} segments)`);
  if (report.graph.segmentsOutside.length) {
    console.log(`                   OUTSIDE: ${report.graph.segmentsOutside.join(', ')}`);
  }
  console.log(`  COVERAGE         ${report.coverage.graphOverInScopeOsmPercent.toFixed(1)} % of in-scope drivable OSM`);
  console.log('');
  console.log('  corridor                     ways   total m   in-scope m   crossing');
  for (const c of report.corridors) {
    console.log(
      `  ${c.name.padEnd(28)} ${String(c.ways).padStart(4)} ${c.totalMetres.toFixed(0).padStart(9)} ` +
        `${c.inScopeMetres.toFixed(0).padStart(12)} ${String(c.crossingWays).padStart(10)}`,
    );
  }
  console.log(`\n  (1 world unit = ${M.toFixed(4)} m)`);
}

main();
