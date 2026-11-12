/**
 * Browser front end for the synthetic-road eviction audit.
 *
 * Two renderers, both driven by the same measured data:
 *
 *   plan   — 2D canvas. Every shipped footprint, the synthetic road with its
 *            carriageway and corridor bands, the evicted footprints painted
 *            by cause, the replacement buildings the perturbation added.
 *   street — 3D perspective of the *actual* generated city (the real
 *            `buildCity()` group), with the synthetic carriageway drawn where
 *            the road would be and the evicted footprints as ghost boxes.
 *
 * Nothing here writes to the world: `runAudit()` installs the road, rebuilds the
 * corridor index, builds, and restores both.
 */

import * as THREE from 'three';
import {
  centrelineDistance,
  runAudit,
  segLocal,
  type AuditResult,
  type EvictionRow,
} from './analysis';
import { SYNTHETIC_ROAD } from './syntheticRoad';
import { ROAD_SEGMENTS } from '../../src/world/layout';
import { LEGACY_SEGMENT_ORDER } from '../../src/world/legacyFillLayout';

const COLORS: Record<string, string> = {
  'carriageway-overlap': '#e5484d',
  'corridor-clearance': '#f2994a',
  'frontage-reroll': '#f2d24b',
  'unexplained': '#8fd3ff',
};

const CLASS_LABEL: Record<string, string> = {
  'carriageway-overlap': 'Footprint under the asphalt',
  'corridor-clearance': 'Footprint in the sidewalk/setback band',
  'frontage-reroll': 'No overlap — frontage re-rolled',
  'unexplained': 'No overlap — propagated re-roll',
};

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
/**
 * A dedicated WebGL canvas. Creating a WebGL context on the 2D canvas is not
 * possible (one context type per canvas), which is why the street view had its
 * own surface — the first attempt reused `#view` and failed outright.
 */
const glCanvas = document.getElementById('view3d') as HTMLCanvasElement;
const hud = document.getElementById('hudbody')!;
const statusEl = document.getElementById('status')!;
const titleEl = document.getElementById('title')!;
const scaleEl = document.getElementById('scale')!;

let audit: AuditResult | null = null;

/** Only shipped-graph buildings are drawn as "the city" in the plan view. */
let baseBuildings: Array<{ x: number; z: number; width: number; depth: number; height: number; yaw: number }> = [];
let addedBuildings: Array<{ x: number; z: number; width: number; depth: number; height: number; yaw: number }> = [];

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type View = { kind: 'plan'; fit: 'world' | 'evictions' | 'region'; region?: Bounds } | { kind: 'street'; u: number; side: number };
let view: View = { kind: 'plan', fit: 'world' };

function resize(): void {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  glCanvas.width = Math.round(r.width * dpr);
  glCanvas.height = Math.round(r.height * dpr);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** World → screen transform for the plan view. */
function planTransform(w: number, h: number) {
  const rows = audit!.rows;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  if (view.kind === 'plan' && view.fit === 'region' && view.region) {
    ({ minX, maxX, minZ, maxZ } = view.region);
  } else if (view.kind === 'plan' && view.fit === 'evictions') {
    for (const r of rows) {
      minX = Math.min(minX, r.x - r.width); maxX = Math.max(maxX, r.x + r.width);
      minZ = Math.min(minZ, r.z - r.depth); maxZ = Math.max(maxZ, r.z + r.depth);
    }
  } else {
    for (const b of baseBuildings) {
      minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
      minZ = Math.min(minZ, b.z); maxZ = Math.max(maxZ, b.z);
    }
    minX -= 40; maxX += 40; minZ -= 40; maxZ += 40;
  }
  const pad = 46;
  const sx = (w - pad * 2) / Math.max(1, maxX - minX);
  const sz = (h - pad * 2) / Math.max(1, maxZ - minZ);
  const s = Math.min(sx, sz);
  const ox = (w - (maxX - minX) * s) / 2 - minX * s;
  const oz = (h - (maxZ - minZ) * s) / 2 - minZ * s;
  return {
    s,
    toScreen: (x: number, z: number): [number, number] => [x * s + ox, z * s + oz],
    bounds: { minX, maxX, minZ, maxZ },
  };
}

function drawFootprint(
  x: number, z: number, width: number, depth: number, yaw: number,
  tf: ReturnType<typeof planTransform>, transform: 'screen' | 'world' = 'screen',
): void {
  const [px, py] = tf.toScreen(x, z);
  const hw = (width / 2) * tf.s;
  const hd = (depth / 2) * tf.s;
  ctx.save();
  ctx.translate(px, py);
  // World yaw is around Y; canvas Y grows downward, hence -yaw.
  ctx.rotate(-yaw);
  ctx.beginPath();
  ctx.rect(-hw, -hd, hw * 2, hd * 2);
  ctx.restore();
  void transform;
}

function drawPlan(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1116';
  ctx.fillRect(0, 0, w, h);
  const tf = planTransform(w, h);

  // --- shipped roads
  for (const seg of ROAD_SEGMENTS) {
    const [x0, y0] = tf.toScreen(seg.ax, seg.az);
    const [x1, y1] = tf.toScreen(seg.bx, seg.bz);
    ctx.strokeStyle = '#18212b';
    ctx.lineWidth = Math.max(1, seg.width * tf.s);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = '#223141';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  // --- shipped buildings
  for (const b of baseBuildings) {
    drawFootprint(b.x, b.z, b.width, b.depth, b.yaw, tf);
    ctx.fillStyle = '#2b3a4a';
    ctx.fill();
  }
  // --- buildings only the perturbation created
  for (const b of addedBuildings) {
    drawFootprint(b.x, b.z, b.width, b.depth, b.yaw, tf);
    ctx.fillStyle = '#1f5f8b';
    ctx.fill();
  }

  // --- the synthetic road
  const A = tf.toScreen(SYNTHETIC_ROAD.ax, SYNTHETIC_ROAD.az);
  const B = tf.toScreen(SYNTHETIC_ROAD.bx, SYNTHETIC_ROAD.bz);
  const corridor = (SYNTHETIC_ROAD.halfWidth + SYNTHETIC_ROAD.sidewalk) * tf.s;
  ctx.save();
  // corridor band (sidewalk + setback)
  ctx.strokeStyle = 'rgba(120,190,255,0.20)';
  ctx.lineWidth = corridor * 2;
  ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
  // asphalt
  ctx.strokeStyle = 'rgba(70,140,220,0.55)';
  ctx.lineWidth = SYNTHETIC_ROAD.halfWidth * 2 * tf.s;
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
  // centreline + carriageway edges
  ctx.strokeStyle = 'rgba(190,225,255,0.75)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
  ctx.setLineDash([]);
  for (const side of [-1, 1]) {
    const nx = SYNTHETIC_ROAD.leftX * SYNTHETIC_ROAD.halfWidth * side * tf.s;
    const ny = SYNTHETIC_ROAD.leftZ * SYNTHETIC_ROAD.halfWidth * side * tf.s;
    ctx.strokeStyle = 'rgba(200,235,255,0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(A[0] + nx, A[1] + ny);
    ctx.lineTo(B[0] + nx, B[1] + ny);
    ctx.stroke();
  }
  ctx.restore();

  // --- evicted footprints, painted by measured cause
  const numbered = view.kind === 'plan' && (view.fit === 'evictions' || view.fit === 'region');
  for (const [i, r] of audit!.rows.entries()) {
    drawFootprint(r.x, r.z, r.width, r.depth, r.yaw, tf);
    const colour = COLORS[r.cls] ?? '#ffffff';
    ctx.fillStyle = colour + '55';
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const [px, py] = tf.toScreen(r.x, r.z);
    if (numbered) {
      ctx.fillStyle = '#0c1116';
      ctx.font = '600 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = String(i + 1);
      const wdt = ctx.measureText(label).width + 5;
      ctx.fillStyle = colour;
      ctx.fillRect(px - wdt / 2, py - 6, wdt, 12);
      ctx.fillStyle = '#0c1116';
      ctx.fillText(label, px, py + 0.5);
    }
  }

  // --- scale bar + caption
  const metres = 100;
  scaleEl.textContent = `scale bar ${metres} m   ·   ${audit!.rows.length} evicted   ${audit!.added} added`;
  const px = metres * tf.s;
  ctx.save();
  ctx.strokeStyle = '#9db0c3';
  ctx.lineWidth = 2;
  const bx = w - px - 24;
  const by = h - 22;
  ctx.beginPath();
  ctx.moveTo(bx, by); ctx.lineTo(bx + px, by);
  ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by + 5);
  ctx.moveTo(bx + px, by - 5); ctx.lineTo(bx + px, by + 5);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ street 3D */

const three = {
  renderer: null as THREE.WebGLRenderer | null,
  scene: null as THREE.Scene | null,
  camera: null as THREE.PerspectiveCamera | null,
  ready: false,
};

async function ensureStreetScene(): Promise<void> {
  if (three.ready) return;
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
  ]);
  const original = [...ROAD_SEGMENTS];
  let city: { group: THREE.Group };
  try {
    ROAD_SEGMENTS.push(SYNTHETIC_ROAD);
    const { rebuildRoadSpatialIndex } = await import('../../src/world/layout');
    rebuildRoadSpatialIndex();
    city = buildCity(new SignAtlas() as never, { shadows: false } as never) as unknown as { group: THREE.Group };
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...original);
    const { rebuildRoadSpatialIndex } = await import('../../src/world/layout');
    rebuildRoadSpatialIndex();
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: glCanvas });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(glCanvas.clientWidth, glCanvas.clientHeight, false);
  renderer.setClearColor(0x0c1116, 1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c1116);
  // Fog is tuned for the street view; the aerial turns it off (see renderBird).
  const streetFog = new THREE.Fog(0x0c1116, 120, 420);
  scene.fog = streetFog;
  (scene as unknown as { _streetFog: THREE.Fog })._streetFog = streetFog;
  scene.add(new THREE.HemisphereLight(0xe8f1fb, 0x3a352c, 3.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.9);
  sun.position.set(120, 200, 80);
  scene.add(sun);
  scene.add(city.group);

  // The road the audit is about, drawn as asphalt with painted edges.
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(SYNTHETIC_ROAD.halfWidth * 2, SYNTHETIC_ROAD.length),
    // A translucent cyan wash, not a grey plane: the audit road must be
    // unmistakable against the shipped asphalt it crosses.
    new THREE.MeshBasicMaterial({ color: 0x36a6ff, transparent: true, opacity: 0.34, depthWrite: false }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.rotation.z = -Math.atan2(SYNTHETIC_ROAD.ux, SYNTHETIC_ROAD.uz);
  asphalt.position.set(
    (SYNTHETIC_ROAD.ax + SYNTHETIC_ROAD.bx) / 2,
    0.10,
    (SYNTHETIC_ROAD.az + SYNTHETIC_ROAD.bz) / 2,
  );
  scene.add(asphalt);
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, SYNTHETIC_ROAD.length),
      new THREE.MeshBasicMaterial({ color: 0xdff1ff }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.rotation.z = -Math.atan2(SYNTHETIC_ROAD.ux, SYNTHETIC_ROAD.uz);
    edge.position.set(
      (SYNTHETIC_ROAD.ax + SYNTHETIC_ROAD.bx) / 2 + SYNTHETIC_ROAD.leftX * SYNTHETIC_ROAD.halfWidth * side,
      0.12,
      (SYNTHETIC_ROAD.az + SYNTHETIC_ROAD.bz) / 2 + SYNTHETIC_ROAD.leftZ * SYNTHETIC_ROAD.halfWidth * side,
    );
    scene.add(edge);
  }

  // Ghost boxes for the buildings this road removes: outlines only. Filled
  // translucent boxes near the camera tinted the entire frame red and hid the
  // very buildings the picture is meant to show.
  for (const r of audit!.rows) {
    const colour = new THREE.Color(COLORS[r.cls] ?? '#ffffff');
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(r.width, r.height, r.depth)),
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.85 }),
    );
    wire.position.set(r.x, r.height / 2, r.z);
    wire.rotation.y = r.yaw;
    scene.add(wire);
  }

  three.renderer = renderer;
  three.scene = scene;
  three.camera = new THREE.PerspectiveCamera(62, glCanvas.clientWidth / glCanvas.clientHeight, 0.35, 900);
  three.ready = true;
}

/** Oblique 3D view of the whole crossing, looking along the synthetic road. */
function renderBird(): void {
  if (!three.ready || !three.renderer || !three.scene || !three.camera) return;
  const { renderer, scene, camera } = three;
  renderer.setSize(glCanvas.clientWidth, glCanvas.clientHeight, false);
  camera.aspect = glCanvas.clientWidth / glCanvas.clientHeight;
  const mx = (SYNTHETIC_ROAD.ax + SYNTHETIC_ROAD.bx) / 2;
  const mz = (SYNTHETIC_ROAD.az + SYNTHETIC_ROAD.bz) / 2;
  // High and pulled back: at 150 m the road corridor was hidden behind the very
  // blocks it crosses. Fog is disabled here — at 330 m the street-tuned fog
  // (120–420) hid the entire city.
  scene.fog = null;
  camera.position.set(mx - 235, 300, mz - 205);
  camera.lookAt(mx + 20, 0, mz + 30);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function renderStreet(u: number): void {
  if (!three.ready || !three.renderer || !three.scene || !three.camera) return;
  const { renderer, scene, camera } = three;
  scene.fog = (scene as unknown as { _streetFog?: THREE.Fog })._streetFog ?? null;
  renderer.setSize(glCanvas.clientWidth, glCanvas.clientHeight, false);
  camera.aspect = glCanvas.clientWidth / glCanvas.clientHeight;
  // Stand on the carriageway, 1.65 m up, 18 % of the way along, looking ahead.
  const t = Math.max(0.04, Math.min(0.96, u));
  const px = SYNTHETIC_ROAD.ax + SYNTHETIC_ROAD.ux * SYNTHETIC_ROAD.length * t;
  const pz = SYNTHETIC_ROAD.az + SYNTHETIC_ROAD.uz * SYNTHETIC_ROAD.length * t;
  camera.position.set(px, 1.65, pz);
  const ahead = Math.min(0.99, t + 0.16);
  camera.lookAt(
    SYNTHETIC_ROAD.ax + SYNTHETIC_ROAD.ux * SYNTHETIC_ROAD.length * ahead,
    2.2,
    SYNTHETIC_ROAD.az + SYNTHETIC_ROAD.uz * SYNTHETIC_ROAD.length * ahead,
  );
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

/* --------------------------------------------------------------------- boot */

function renderHud(): void {
  const a = audit!;
  const total = a.rows.length;
  const direct = a.counts['carriageway-overlap'] + a.counts['corridor-clearance'];
  const collateral = total - direct;
  const rows = [
    ['carriageway-overlap', a.counts['carriageway-overlap']],
    ['corridor-clearance', a.counts['corridor-clearance']],
    ['frontage-reroll', a.counts['frontage-reroll']],
    ['unexplained', a.counts['unexplained']],
  ] as const;
  hud.innerHTML = `
    <div class="row"><span class="k">Shipped world</span><span class="v">${a.baseCampaign.buildings} · ${a.baseCampaign.digest}</span></div>
    <div class="row"><span class="k">With synthetic road</span><span class="v">${a.perturbed.buildings} buildings</span></div>
    <div class="row"><span class="k">Evicted</span><span class="big">${total}</span></div>
    <div class="row"><span class="k">Genuine conflicts</span><span class="v">${direct}</span></div>
    <div class="row"><span class="k">Collateral</span><span class="v">${collateral}</span></div>

    <h2>Measured cause</h2>
    ${rows.map(([cls, n]) => `
      <div class="row">
        <span class="sw" style="background:${COLORS[cls]}"></span>
        <span class="k">${CLASS_LABEL[cls]}</span>
        <span class="v">${n}</span>
      </div>`).join('')}

    <h2>Geometry drawn</h2>
    <div class="row"><span class="sw" style="background:#2b3a4a"></span><span class="k">Shipped footprint</span><span class="v">845</span></div>
    <div class="row"><span class="sw" style="background:#1f5f8b"></span><span class="k">Added by the road</span><span class="v">${a.added}</span></div>
    <div class="row"><span class="sw" style="background:rgba(70,140,220,.55)"></span><span class="k">Carriageway 9 m</span></div>
    <div class="row"><span class="sw" style="background:rgba(120,190,255,.20)"></span><span class="k">Corridor + sidewalk 12 m</span></div>

    <h2>Controls</h2>
    <div class="row"><span class="k">Road 700 m away</span><span class="v">${a.control.evicted} evicted</span></div>
    <div class="row"><span class="k">Road through city</span><span class="v">${total} evicted</span></div>

    <div class="note">
      Diagnostic scene. The synthetic road exists only in this page's build:
      it is installed, the corridor index is rebuilt, the world is generated,
      then both are restored. Production data is untouched.
    </div>`;
}

function draw(): void {
  if (!audit) return;
  if (view.kind === 'plan') {
    resize();
    drawPlan();
    titleEl.textContent = view.fit === 'world'
      ? 'Plan view · whole shipped city · paint = measured eviction cause'
      : view.fit === 'region'
        ? 'Plan view · zoom on the densest eviction cluster · numbers match the audit table'
        : `Plan view · evicted footprints only · numbered 1–${audit!.rows.length}`;
    drawPlanScaleNote();
  }
}

function drawPlanScaleNote(): void {
  if (!audit || view.kind !== 'plan') return;
  const tf = planTransform(canvas.clientWidth, canvas.clientHeight);
  const rows = audit.rows;
  const nearest = rows.reduce((m, r) => Math.min(m, r.distanceToCentreline), Infinity);
  const farthest = rows.reduce((m, r) => Math.max(m, r.distanceToCentreline), 0);
  scaleEl.textContent =
    `${audit.rows.length} evicted · nearest ${nearest.toFixed(1)} m · farthest ${farthest.toFixed(1)} m ` +
    `· 100 m bar · ${tf.s.toFixed(2)} px/m`;
}

async function boot(): Promise<void> {
  resize();
  audit = await runAudit();
  // Colliders, not the snapshot: `yaw` is required for an honest footprint.
  baseBuildings = audit.baseFootprints;
  const baseKeys = new Set(baseBuildings.map((b) => `${b.x},${b.z},${b.width},${b.depth},${b.height}`));
  addedBuildings = audit.perturbedFootprints.filter(
    (b) => !baseKeys.has(`${b.x},${b.z},${b.width},${b.depth},${b.height}`),
  );
  statusEl.remove();
  renderHud();
  draw();

  // `legend` is expressed in the HUD; keep the on-canvas title in sync.
  titleEl.textContent = 'Plan view · whole shipped city · paint = measured eviction cause';

  (window as unknown as Record<string, unknown>).__audit = {
    ready: true,
    summary: {
      base: audit.baseCampaign,
      perturbed: audit.perturbed,
      evicted: audit.evicted,
      added: audit.added,
      counts: audit.counts,
      control: audit.control,
      frontages: audit.frontages.length,
    },
    rows: audit.rows.map((r: EvictionRow) => ({
      id: r.id, cls: r.cls, x: +r.x.toFixed(2), z: +r.z.toFixed(2),
      d: +r.distanceToCentreline.toFixed(2),
      overlap: +r.asphaltOverlapDepth.toFixed(2),
      front: `${r.frontSegment}#${r.frontSide}`,
      u: +r.frontU.toFixed(1),
      nearestAfter: r.nearestAfter,
    })),
    async setPlan(fit: 'world' | 'evictions') {
      view = { kind: 'plan', fit };
      glCanvas.style.display = 'none';
      canvas.style.display = 'block';
      await draw();
    },
    async setRegion(minX: number, minZ: number, maxX: number, maxZ: number) {
      view = { kind: 'plan', fit: 'region', region: { minX, minZ, maxX, maxZ } };
      glCanvas.style.display = 'none';
      canvas.style.display = 'block';
      await draw();
    },
    /** Bounding box of the evicted footprints for one cause class. */
    classBounds(cls: string) {
      const rs = audit!.rows.filter((r) => r.cls === cls);
      if (!rs.length) return null;
      return {
        minX: Math.min(...rs.map((r) => r.x - r.width)),
        maxX: Math.max(...rs.map((r) => r.x + r.width)),
        minZ: Math.min(...rs.map((r) => r.z - r.depth)),
        maxZ: Math.max(...rs.map((r) => r.z + r.depth)),
        count: rs.length,
      };
    },
    async setStreet(u: number) {
      await ensureStreetScene();
      view = { kind: 'street', u, side: 1 };
      canvas.style.display = 'none';
      glCanvas.style.display = 'block';
      titleEl.textContent = `Street level · on the synthetic carriageway at ${(u * 100).toFixed(0)}% · ghost boxes = evicted footprints`;
      scaleEl.textContent = 'eye height 1.65 m';
      renderStreet(u);
    },
    async setBird() {
      await ensureStreetScene();
      view = { kind: 'street', u: 0.5, side: 1 };
      canvas.style.display = 'none';
      glCanvas.style.display = 'block';
      titleEl.textContent = '3D bird view · cyan = the synthetic carriageway crossing the shipped streets';
      scaleEl.textContent = 'oblique aerial, 300 m above the city, fog off';
      renderBird();
    },
    focusOn(cls: string) {
      const r = audit!.rows.find((x) => x.cls === cls);
      return r ? { x: r.x, z: r.z } : null;
    },
  };
}

boot().catch((err) => {
  statusEl.textContent = `audit failed: ${String(err)}`;
  console.error(err);
});

window.addEventListener('resize', () => {
  if (view.kind === 'plan') draw();
  else if (view.kind === 'street') renderStreet(view.u);
});

void centrelineDistance;
void segLocal;
void LEGACY_SEGMENT_ORDER;
