/**
 * Full-screen interactive Mohammadpur map.
 *
 * Pan / zoom / tap, rendered from the same data the world is built from:
 * `ROAD_SEGMENTS` for the road layout and `POIS` for the landmarks. Routes are
 * computed by `mapRouting` over the live gameplay graph, so a route drawn here
 * is a route the rickshaw can actually drive. Places the graph cannot reach are
 * listed but explicitly marked NOT CONNECTED YET and offer no route.
 *
 * The player is never moved by this screen; it only reports a destination.
 */

import type { RoadSegment } from '../world/layout';
import type { Poi, PoiCategory } from '../world/poiRegistry';
import { buildRouteToPoi, poiReach, type MapPoint, type RouteResult } from '../world/mapRouting';

export interface MapScreenOptions {
  pois: Poi[];
  segments: RoadSegment[];
  /** Live player pose, read only while the map is open. */
  getPlayer: () => MapPoint & { yaw: number };
  onSetDestination: (poi: Poi) => void;
  onClearDestination: () => void;
  onClose: () => void;
}

const CATEGORY_COLOUR: Record<PoiCategory, string> = {
  market: '#e0a33a',
  mosque: '#4fa3d1',
  park: '#5cbf6a',
  landmark: '#c96fd1',
  education: '#7f8fd6',
  transport: '#d9744f',
  camp: '#d1b24f',
  commercial: '#9ad46a',
};

const CATEGORY_LABEL: Record<PoiCategory, string> = {
  market: 'বাজার / Market',
  mosque: 'মসজিদ / Mosque',
  park: 'পার্ক / Park',
  landmark: 'ল্যান্ডমার্ক / Landmark',
  education: 'শিক্ষা / Education',
  transport: 'পরিবহন / Transport',
  camp: 'ক্যাম্প / Settlement',
  commercial: 'বাণিজ্যিক / Commercial',
};

const ROAD_STYLE: Record<RoadSegment['kind'], { width: number; colour: string }> = {
  main: { width: 7, colour: '#2f6b4a' },
  medium: { width: 4.5, colour: '#2a5a40' },
  gali: { width: 2.5, colour: '#244a36' },
};

/**
 * Canvas text does not inherit the CSS stack, and the default headless/system
 * face has no Bengali coverage, so the bundled Hind Siliguri must be named
 * explicitly — the same convention the world textures and posters use.
 */
const FONT_BN = '"Hind Siliguri", "Noto Sans Bengali", sans-serif';

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 6;

export class MapScreen {
  private readonly opts: MapScreenOptions;
  private root: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private sheet: HTMLElement | null = null;
  private selected: Poi | null = null;
  private route: RouteResult | null = null;
  private destinationId: string | null = null;
  private view = { x: 0, z: 0, zoom: 1.1 };
  private readonly minView = { x: -260, z: -300, w: 560, h: 620 };
  private drag: { id: number; x: number; y: number; vx: number; vz: number; moved: boolean } | null = null;
  private pinch: { distance: number; zoom: number } | null = null;
  private raf = 0;

  constructor(opts: MapScreenOptions) {
    this.opts = opts;
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Existing destination, so the sheet can show what is already set. */
  setDestinationState(poiId: string | null): void {
    this.destinationId = poiId;
    if (this.isOpen) this.refreshRoute();
  }

  open(initialDestination: string | null = null): void {
    if (this.root) return;
    this.destinationId = initialDestination;

    const player = this.opts.getPlayer();
    this.view = { x: player.x, z: player.z, zoom: 1.8 };

    const root = document.createElement('div');
    root.className = 'map-screen';
    root.setAttribute('data-screen', 'map');

    const canvas = document.createElement('canvas');
    canvas.className = 'map-canvas';
    root.append(canvas);

    const header = document.createElement('div');
    header.className = 'map-header';
    header.append(
      Object.assign(document.createElement('div'), {
        className: 'map-title',
        textContent: 'মোহাম্মদপুর · MOHAMMADPUR',
      }),
      Object.assign(document.createElement('div'), {
        className: 'map-sub',
        textContent: 'Tap a place for details · drag to pan · pinch to zoom',
      }),
    );

    const closeBtn = document.createElement('button');
    closeBtn.className = 'map-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close map');
    closeBtn.addEventListener('click', () => this.opts.onClose());
    header.append(closeBtn);
    root.append(header);

    const zoomRow = document.createElement('div');
    zoomRow.className = 'map-zoom';
    const mkZoom = (label: string, delta: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        this.view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.zoom * delta));
        this.draw();
      });
      return b;
    };
    zoomRow.append(mkZoom('+', 1.4), mkZoom('−', 1 / 1.4));
    root.append(zoomRow);

    const sheet = document.createElement('div');
    sheet.className = 'map-sheet hidden';
    root.append(sheet);

    document.body.append(root);
    this.root = root;
    this.canvas = canvas;
    this.sheet = sheet;

    this.bindPointer(canvas);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  close(): void {
    if (!this.root) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('resize', this.resize);
    this.root.remove();
    this.root = null;
    this.canvas = null;
    this.sheet = null;
    this.selected = null;
    this.route = null;
    this.drag = null;
    this.pinch = null;
  }

  private readonly resize = (): void => {
    const canvas = this.canvas;
    if (!canvas || !this.root) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.draw();
  };

  /** Recompute the drawn route when the destination or the graph changes. */
  private refreshRoute(): void {
    this.route = null;
    if (!this.destinationId) {
      this.draw();
      return;
    }
    const poi = this.opts.pois.find((p) => p.id === this.destinationId);
    if (poi) {
      const player = this.opts.getPlayer();
      this.route = buildRouteToPoi({ x: player.x, z: player.z }, poi);
    }
    this.draw();
  }

  private worldToScreen(x: number, z: number): { x: number; y: number } {
    const canvas = this.canvas!;
    const dpr = canvas.width / (this.root?.clientWidth || 1);
    const cx = canvas.width / dpr / 2;
    const cy = canvas.height / dpr / 2;
    return {
      x: cx + (x - this.view.x) * this.view.zoom,
      y: cy + (z - this.view.z) * this.view.zoom,
    };
  }

  private screenToWorld(sx: number, sy: number): MapPoint {
    const w = this.root?.clientWidth || 1;
    const h = this.root?.clientHeight || 1;
    return {
      x: this.view.x + (sx - w / 2) / this.view.zoom,
      z: this.view.z + (sy - h / 2) / this.view.zoom,
    };
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    const points = new Map<number, { x: number; y: number }>();

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      points.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (points.size === 2) {
        const [a, b] = [...points.values()];
        this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.view.zoom };
        this.drag = null;
        return;
      }
      this.drag = { id: e.pointerId, x: e.offsetX, y: e.offsetY, vx: this.view.x, vz: this.view.z, moved: false };
    });

    canvas.addEventListener('pointermove', (e) => {
      if (points.has(e.pointerId)) points.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pinch && points.size === 2) {
        const [a, b] = [...points.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch.distance > 0) {
          this.view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (this.pinch.zoom * d) / this.pinch.distance));
          this.draw();
        }
        return;
      }
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.offsetX - this.drag.x;
      const dy = e.offsetY - this.drag.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.drag.moved = true;
      this.view.x = this.drag.vx - dx / this.view.zoom;
      this.view.z = this.drag.vz - dy / this.view.zoom;
      this.draw();
    });

    const end = (e: PointerEvent): void => {
      points.delete(e.pointerId);
      if (points.size < 2) this.pinch = null;
      if (this.drag && this.drag.id === e.pointerId) {
        if (!this.drag.moved) this.tapAt(e.offsetX, e.offsetY);
        this.drag = null;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.zoom * factor));
        this.draw();
      },
      { passive: false },
    );
  }

  /** Nearest POI within a tap tolerance (12 CSS px), else deselect. */
  private tapAt(sx: number, sy: number): void {
    let best: { poi: Poi; d: number } | null = null;
    for (const poi of this.opts.pois) {
      const s = this.worldToScreen(poi.x, poi.z);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d <= 18 && (!best || d < best.d)) best = { poi, d };
    }
    this.selected = best?.poi ?? null;
    this.renderSheet();
    this.draw();
  }

  private renderSheet(): void {
    const sheet = this.sheet;
    if (!sheet) return;
    sheet.replaceChildren();
    if (!this.selected) {
      sheet.classList.add('hidden');
      return;
    }
    sheet.classList.remove('hidden');

    const poi = this.selected;
    const reach = poiReach(poi);
    const isCurrent = this.destinationId === poi.id;

    const row = document.createElement('div');
    row.className = 'map-sheet-head';
    const dot = document.createElement('i');
    dot.className = 'map-dot';
    dot.style.background = CATEGORY_COLOUR[poi.category];
    row.append(
      dot,
      Object.assign(document.createElement('div'), { className: 'map-sheet-name', textContent: poi.nameBn }),
    );
    sheet.append(row);

    sheet.append(
      Object.assign(document.createElement('div'), { className: 'map-sheet-en', textContent: poi.nameEn }),
      Object.assign(document.createElement('div'), {
        className: 'map-sheet-meta',
        textContent: `${CATEGORY_LABEL[poi.category]} · OSM ${poi.osmType} ${poi.osmId}`,
      }),
      Object.assign(document.createElement('div'), { className: 'map-sheet-note', textContent: poi.note }),
    );

    const actions = document.createElement('div');
    actions.className = 'map-sheet-actions';

    if (reach.routable) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'map-btn primary';
      go.setAttribute('data-action', 'set-destination');
      go.textContent = isCurrent ? 'CANCEL DESTINATION' : 'SET DESTINATION';
      go.addEventListener('click', () => {
        if (isCurrent) {
          this.destinationId = null;
          this.route = null;
          this.opts.onClearDestination();
        } else {
          this.destinationId = poi.id;
          this.opts.onSetDestination(poi);
        }
        this.refreshRoute();
        this.renderSheet();
      });
      actions.append(go);
    } else {
      const blocked = document.createElement('div');
      blocked.className = 'map-btn blocked';
      blocked.setAttribute('data-not-connected', 'true');
      blocked.textContent = 'NOT CONNECTED YET';
      actions.append(blocked);
      sheet.append(
        Object.assign(document.createElement('div'), {
          className: 'map-sheet-warn',
          textContent:
            reach.reason === 'outside-world'
              ? 'This place is real but lies outside the drivable world, so no route can be offered.'
              : 'No road in the current gameplay graph reaches this place yet.',
        }),
      );
    }
    sheet.append(actions);
  }

  private loop = (): void => {
    if (!this.root) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const canvas = this.canvas;
    const root = this.root;
    if (!canvas || !root) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = canvas.width / (root.clientWidth || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = root.clientWidth;
    const h = root.clientHeight;

    ctx.fillStyle = '#08120e';
    ctx.fillRect(0, 0, w, h);

    // Faint grid so panning has a sense of scale.
    ctx.strokeStyle = 'rgba(60,110,80,0.14)';
    ctx.lineWidth = 1;
    const step = 50;
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(w, h);
    for (let x = Math.ceil(topLeft.x / step) * step; x < bottomRight.x; x += step) {
      const s = this.worldToScreen(x, topLeft.z);
      ctx.beginPath();
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, h);
      ctx.stroke();
    }
    for (let z = Math.ceil(topLeft.z / step) * step; z < bottomRight.z; z += step) {
      const s = this.worldToScreen(topLeft.x, z);
      ctx.beginPath();
      ctx.moveTo(0, s.y);
      ctx.lineTo(w, s.y);
      ctx.stroke();
    }

    // Playable extent.
    const extentNW = this.worldToScreen(this.minView.x, this.minView.z);
    const extentSE = this.worldToScreen(
      this.minView.x + this.minView.w,
      this.minView.z + this.minView.h,
    );
    ctx.strokeStyle = 'rgba(154,212,106,0.35)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(extentNW.x, extentNW.y, extentSE.x - extentNW.x, extentSE.y - extentNW.y);
    ctx.setLineDash([]);

    // Roads, thin to thick so junctions read correctly.
    const order: RoadSegment['kind'][] = ['gali', 'medium', 'main'];
    for (const kind of order) {
      const style = ROAD_STYLE[kind];
      ctx.strokeStyle = style.colour;
      ctx.lineCap = 'round';
      for (const seg of this.opts.segments) {
        if (seg.kind !== kind) continue;
        const a = this.worldToScreen(seg.ax, seg.az);
        const b = this.worldToScreen(seg.bx, seg.bz);
        ctx.lineWidth = Math.max(1.5, style.width * Math.min(this.view.zoom, 2.2) * 0.55);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Road names once there is room for them.
    if (this.view.zoom >= 1.5) {
      ctx.fillStyle = 'rgba(190,220,200,0.55)';
      ctx.font = `600 10px ${FONT_BN}`;
      ctx.textAlign = 'center';
      const drawn = new Set<string>();
      for (const seg of this.opts.segments) {
        if (seg.kind === 'gali' || drawn.has(seg.nameEn)) continue;
        drawn.add(seg.nameEn);
        const mid = this.worldToScreen((seg.ax + seg.bx) / 2, (seg.az + seg.bz) / 2);
        if (mid.x < -50 || mid.x > w + 50 || mid.y < -20 || mid.y > h + 20) continue;
        ctx.fillText(seg.nameEn, mid.x, mid.y - 6);
      }
    }

    // Active route.
    const route = this.route;
    if (route) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      route.points.forEach((p, i) => {
        const s = this.worldToScreen(p.x, p.z);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,209,102,0.28)';
      ctx.lineWidth = 11;
      ctx.stroke();
    }

    // POIs. Labels are collected first, then placed greedily so dense clusters
    // (Town Hall has five POIs within ~30 m) stay readable instead of overprinting.
    const labelCandidates: { poi: Poi; sx: number; sy: number; isSel: boolean; isDest: boolean }[] = [];
    for (const poi of this.opts.pois) {
      const s = this.worldToScreen(poi.x, poi.z);
      if (s.x < -30 || s.x > w + 30 || s.y < -30 || s.y > h + 30) continue;
      const reached = poiReach(poi).routable;
      const isSel = this.selected?.id === poi.id;
      const isDest = this.destinationId === poi.id;
      ctx.beginPath();
      ctx.arc(s.x, s.y, isSel ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = reached ? CATEGORY_COLOUR[poi.category] : 'rgba(150,150,150,0.55)';
      ctx.fill();
      ctx.lineWidth = isDest ? 3 : 1.5;
      ctx.strokeStyle = isDest ? '#ffd166' : 'rgba(8,18,14,0.9)';
      ctx.stroke();
      if (!reached) {
        // Small slash marks the place as unreachable without hiding it.
        ctx.beginPath();
        ctx.moveTo(s.x - 3, s.y + 3);
        ctx.lineTo(s.x + 3, s.y - 3);
        ctx.strokeStyle = '#08120e';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (this.view.zoom >= 1.2 || isSel || isDest) {
        labelCandidates.push({ poi, sx: s.x, sy: s.y, isSel, isDest });
      }
    }

    // Label placement: the selected/destination labels win, then the rest.
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    labelCandidates.sort((a, b) => Number(b.isSel || b.isDest) - Number(a.isSel || a.isDest));
    for (const label of labelCandidates) {
      const emphasis = label.isSel || label.isDest;
      ctx.font = emphasis ? `700 13px ${FONT_BN}` : `600 12px ${FONT_BN}`;
      const width = ctx.measureText(label.poi.nameBn).width;
      const baseline = label.sy + (label.isSel ? 22 : 19);
      const box = {
        x1: label.sx - width / 2 - 3,
        y1: baseline - 13,
        x2: label.sx + width / 2 + 3,
        y2: baseline + 4,
      };
      const clashes = placed.some(
        (p) => box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1,
      );
      if (clashes && !emphasis) continue;
      placed.push(box);
      ctx.textAlign = 'center';
      if (emphasis) {
        ctx.fillStyle = 'rgba(8,18,14,0.82)';
        ctx.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
      }
      ctx.fillStyle = emphasis ? '#f4ffe9' : 'rgba(226,240,230,0.85)';
      ctx.fillText(label.poi.nameBn, label.sx, baseline);
    }

    // Player.
    const player = this.opts.getPlayer();
    const p = this.worldToScreen(player.x, player.z);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-player.yaw + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#39c0ff';
    ctx.fill();
    ctx.strokeStyle = '#08120e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}
