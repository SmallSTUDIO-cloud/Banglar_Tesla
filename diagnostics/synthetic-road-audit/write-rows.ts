/**
 * Serialises the measured eviction audit to the two table formats the report
 * cites. Run it, then split the marked blocks:
 *
 *   npx vite-node diagnostics/synthetic-road-audit/write-rows.ts > /tmp/rows.out
 *
 * `@types/node` is not part of this project, so — like `probe-cascade.ts` — this
 * file prints and stays free of `node:` imports; the caller does the writing.
 * The tables are derived from `runAudit()`, never retyped.
 */

import { installDomShim } from '../../tools/domShim';

installDomShim();

const { runAudit } = await import('./analysis');

const audit = await runAudit();
const rows = [...audit.rows].sort((a, b) => a.id.localeCompare(b.id));

const cell = (r: (typeof rows)[number]) => [
  r.id,
  r.x.toFixed(2),
  r.z.toFixed(2),
  r.frontSegment,
  String(r.frontSide),
  r.frontU.toFixed(1),
  r.distanceToCentreline.toFixed(2),
  (r.distanceToCentreline - 4.5 >= 0 ? '+' : '') + (r.distanceToCentreline - 4.5).toFixed(2),
  r.asphaltOverlapDepth.toFixed(2),
  r.nearestAfter,
  r.cls,
];

const csv = [
  'n,building_id,x,z,frontage_segment,side,u_along_m,centreline_distance_m,signed_clearance_m,asphalt_overlap_depth_m,nearest_road_after,cause',
  ...rows.map((r, i) => [String(i + 1), ...cell(r)].map((v) => (/[",]/.test(v) ? `"${v}"` : v)).join(',')),
].join('\n');

const md = [
  '| # | building id | x, z (m) | frontage | u (m) | dist. to centreline (m) | signed clearance to asphalt (m) | asphalt overlap depth (m) | nearest road after | cause |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r, i) => {
    const c = cell(r);
    return `| ${i + 1} | \`${c[0]}\` | ${Number(c[1]).toFixed(1)}, ${Number(c[2]).toFixed(1)} | ${c[3]} / ${c[4]} | ${c[5]} | ${c[6]} | ${c[7]} | ${c[8]} | ${c[9]} | ${c[10]} |`;
  }),
].join('\n');

console.log('CSV_BEGIN');
console.log(csv);
console.log('CSV_END');
console.log('MD_BEGIN');
console.log(md);
console.log('MD_END');
console.error(
  `rows=${rows.length} base=${audit.baseCampaign.buildings}/${audit.baseCampaign.digest} ` +
    `perturbed=${audit.perturbed.buildings}/${audit.perturbed.digest} ` +
    `evicted=${audit.evicted} added=${audit.added} control=${audit.control.evicted} ` +
    `classes=${JSON.stringify(audit.counts)}`,
);
