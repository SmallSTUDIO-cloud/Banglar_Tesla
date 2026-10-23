/**
 * Procedural texture generation. Every texture in the game is drawn here at
 * runtime — there are no downloaded image assets, so nothing is unlicensed.
 *
 * Textures are cached (a single canvas per material family) and shared between
 * meshes to keep GPU memory and draw calls low on phones.
 */

import * as THREE from 'three';
import { fbm2, mulberry32, TAU, clamp01 } from '../core/mathx';
import type { SignDef } from './layout';

export const FONT_FAMILY = '"Hind Siliguri", "Noto Sans Bengali", sans-serif';

function canvas2d(w: number, h = w): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  txRegistry.push(tex);
  return tex;
}

/** Track every texture so quality changes can re-apply anisotropy/filters. */
export const txRegistry: THREE.Texture[] = [];

const cache = new Map<string, THREE.Texture>();

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = make();
  cache.set(key, tex);
  return tex;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  count: number,
  colors: string[],
  rng: () => number,
  rMin = 0.5,
  rMax = 2.2,
): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const r = rMin + rng() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, r, 0, TAU);
    ctx.fill();
  }
}

/** Asphalt: dark, speckled, with patches, cracks and paint wear. */
export function asphaltTexture(): THREE.Texture {
  return cached('asphalt', () => {
    const size = 512;
    const { canvas, ctx } = canvas2d(size);
    const rng = mulberry32(7);
    ctx.fillStyle = '#565553';
    ctx.fillRect(0, 0, size, size);

    // large-scale tonal blotches
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm2(x / 46, y / 46, 4);
        const g = fbm2(x / 9 + 11, y / 9 + 3, 2);
        const v = 74 + n * 30 + g * 20;
        const i = (y * size + x) * 4;
        img.data[i] = v * 1.02;
        img.data[i + 1] = v * 1.0;
        img.data[i + 2] = v * 0.96;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // patched repairs
    for (let i = 0; i < 7; i++) {
      const px = rng() * size;
      const py = rng() * size;
      const w = 40 + rng() * 120;
      const h = 26 + rng() * 90;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rng() * TAU);
      ctx.fillStyle = `rgba(${58 + rng() * 18},${56 + rng() * 16},${52 + rng() * 14},0.30)`;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 6 + rng() * 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(22,22,22,0.28)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // cracks
    ctx.strokeStyle = 'rgba(24,24,24,0.30)';
    for (let i = 0; i < 26; i++) {
      let x = rng() * size;
      let y = rng() * size;
      ctx.lineWidth = 0.6 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 3 + Math.floor(rng() * 5);
      for (let s = 0; s < steps; s++) {
        x += (rng() - 0.5) * 42;
        y += (rng() - 0.5) * 42;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    speckle(ctx, size, size, 2600, ['rgba(120,118,112,0.22)', 'rgba(24,24,24,0.35)', 'rgba(90,88,84,0.25)'], rng, 0.4, 1.8);
    // pale dust film near edges
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, 'rgba(160,148,124,0.06)');
    grad.addColorStop(1, 'rgba(40,36,30,0.1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return toTexture(canvas);
  });
}

/** Concrete/plaster wall base; vertex colours multiply this to give variety. */
export function plasterTexture(): THREE.Texture {
  return cached('plaster', () => {
    const size = 512;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = '#d8cfbd';
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm2(x / 60, y / 60, 4) * 0.5 + fbm2(x / 7, y / 7, 2) * 0.5;
        const v = 196 + n * 44;
        const i = (y * size + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v * 0.985;
        img.data[i + 2] = v * 0.955;
      }
    }
    ctx.putImageData(img, 0, 0);
    // damp streaks running down from the top
    const rng = mulberry32(23);
    for (let i = 0; i < 34; i++) {
      const x = rng() * size;
      const w = 2 + rng() * 9;
      const h = 40 + rng() * 260;
      const g = ctx.createLinearGradient(x, 0, x, h);
      g.addColorStop(0, 'rgba(84,76,64,0.20)');
      g.addColorStop(1, 'rgba(84,76,64,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, h);
    }
    // peeled paint patches
    for (let i = 0; i < 16; i++) {
      const x = rng() * size;
      const y = rng() * size;
      ctx.fillStyle = `rgba(${168 + rng() * 20},${156 + rng() * 20},${138 + rng() * 20},0.5)`;
      ctx.beginPath();
      ctx.ellipse(x, y, 6 + rng() * 26, 4 + rng() * 18, rng() * TAU, 0, TAU);
      ctx.fill();
    }
    return toTexture(canvas);
  });
}

/** Exposed brick (used on lower floors / boundary walls). */
export function brickTexture(): THREE.Texture {
  return cached('brick', () => {
    const size = 512;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = '#c4b7a4';
    ctx.fillRect(0, 0, size, size);
    const rng = mulberry32(101);
    const bh = 26;
    const bw = 62;
    for (let row = 0; row < size / bh + 1; row++) {
      const offset = row % 2 === 0 ? 0 : bw / 2;
      for (let col = -1; col < size / bw + 1; col++) {
        const x = col * bw + offset;
        const y = row * bh;
        const shade = 118 + rng() * 46;
        ctx.fillStyle = `rgb(${shade + 24},${shade * 0.62},${shade * 0.5})`;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 2, bw - 4, bh - 4, 2.5);
        ctx.fill();
      }
    }
    speckle(ctx, size, size, 900, ['rgba(255,236,214,0.10)', 'rgba(40,22,16,0.18)'], rng, 0.5, 1.8);
    return toTexture(canvas);
  });
}

/** Corrugated metal shutter for closed shops. */
export function shutterTexture(): THREE.Texture {
  return cached('shutter', () => {
    const size = 256;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = '#7d8388';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 8) {
      const g = ctx.createLinearGradient(0, y, 0, y + 8);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(0.5, 'rgba(60,66,70,0.18)');
      g.addColorStop(1, 'rgba(20,24,26,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, size, 8);
    }
    const rng = mulberry32(5);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${120 + rng() * 40},${70 + rng() * 30},${30 + rng() * 20},${0.1 + rng() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(rng() * size, rng() * size, 6 + rng() * 24, 3 + rng() * 12, rng() * TAU, 0, TAU);
      ctx.fill();
    }
    return toTexture(canvas);
  });
}

/** Canvas / canopy cloth with a subtle woven texture. */
export function clothTexture(): THREE.Texture {
  return cached('cloth', () => {
    const size = 256;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) {
      ctx.fillStyle = y % 6 === 0 ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, y, size, 1.5);
    }
    for (let x = 0; x < size; x += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.03)';
      ctx.fillRect(x, 0, 1, size);
    }
    return toTexture(canvas);
  });
}

/** Striped tarpaulin for shop awnings. */
export function awningTexture(colorA = '#1f6b4f', colorB = '#f0e6cf'): THREE.Texture {
  return cached(`awning:${colorA}:${colorB}`, () => {
    const size = 128;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = colorB;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = colorA;
    for (let x = 0; x < size; x += 32) ctx.fillRect(x, 0, 16, size);
    const rng = mulberry32(9);
    speckle(ctx, size, size, 120, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.06)'], rng, 0.5, 1.6);
    return toTexture(canvas);
  });
}

/** Sidewalk paving slabs. */
export function pavementTexture(): THREE.Texture {
  return cached('pavement', () => {
    const size = 512;
    const { canvas, ctx } = canvas2d(size);
    const rng = mulberry32(33);
    ctx.fillStyle = '#8b877e';
    ctx.fillRect(0, 0, size, size);
    const tile = 64;
    for (let y = 0; y < size; y += tile) {
      for (let x = 0; x < size; x += tile) {
        const v = 128 + rng() * 36;
        ctx.fillStyle = `rgb(${v},${v * 0.99},${v * 0.94})`;
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x + 2, y + tile - 5, tile - 4, 3);
      }
    }
    speckle(ctx, size, size, 1400, ['rgba(30,28,24,0.14)', 'rgba(220,214,200,0.12)'], rng, 0.4, 1.5);
    return toTexture(canvas);
  });
}

/** Dirty water / river surface. */
export function waterTexture(): THREE.Texture {
  return cached('water', () => {
    const size = 512;
    const { canvas, ctx } = canvas2d(size);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm2(x / 38, y / 38, 5);
        const i = (y * size + x) * 4;
        img.data[i] = 46 + n * 40;
        img.data[i + 1] = 72 + n * 46;
        img.data[i + 2] = 64 + n * 40;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(canvas);
  });
}

/** Sign atlas: 16 hand-painted shop boards baked into one 2048² texture. */
export class SignAtlas {
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private index = 0;
  private readonly cols = 4;
  private readonly rows = 4;
  private readonly size = 2048;
  private rects = new Map<string, { u0: number; v0: number; u1: number; v1: number }>();

  constructor() {
    const made = canvas2d(this.size);
    this.canvas = made.canvas;
    this.ctx = made.ctx;
    this.ctx.fillStyle = '#2b2b2b';
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  uvFor(def: SignDef): { u0: number; v0: number; u1: number; v1: number } {
    const key = def.bn;
    const existing = this.rects.get(key);
    if (existing) return existing;
    const col = this.index % this.cols;
    const row = Math.floor(this.index / this.cols) % this.rows;
    this.index++;
    this.drawSign(col, row, def);
    const cellW = this.size / this.cols;
    const cellH = this.size / this.rows;
    const rect = {
      u0: (col * cellW + 6) / this.size,
      u1: ((col + 1) * cellW - 6) / this.size,
      v0: 1 - ((row + 1) * cellH - 6) / this.size,
      v1: 1 - (row * cellH + 6) / this.size,
    };
    this.rects.set(key, rect);
    this.texture.needsUpdate = true;
    return rect;
  }

  private drawSign(col: number, row: number, def: SignDef): void {
    const cellW = this.size / this.cols;
    const cellH = this.size / this.rows;
    const x = col * cellW;
    const y = row * cellH;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    // board background with a painted border
    ctx.fillStyle = def.bg;
    ctx.fillRect(0, 0, cellW, cellH);
    const rng = mulberry32(def.bn.length * 31 + x + y);
    // subtle brush texture
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.012 + rng() * 0.02})`;
      ctx.fillRect(rng() * cellW, rng() * cellH, 20 + rng() * 90, 1 + rng() * 3);
    }
    ctx.strokeStyle = def.fg;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, cellW - 32, cellH - 32);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = def.bg === '#e8d7a8' ? '#8a3a22' : '#f0c04a';
    ctx.lineWidth = 3;
    ctx.strokeRect(26, 26, cellW - 52, cellH - 52);

    // text
    ctx.fillStyle = def.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const baseSize = def.bn.length > 16 ? 52 : def.bn.length > 11 ? 64 : 76;
    ctx.font = `700 ${baseSize}px ${FONT_FAMILY}`;
    const maxWidth = cellW - 90;
    let size = baseSize;
    while (ctx.measureText(def.bn).width > maxWidth && size > 26) {
      size -= 3;
      ctx.font = `700 ${size}px ${FONT_FAMILY}`;
    }
    ctx.fillText(def.bn, cellW / 2, cellH * (def.sub ? 0.44 : 0.5));
    if (def.sub) {
      ctx.font = `400 ${Math.max(22, size * 0.42)}px ${FONT_FAMILY}`;
      ctx.globalAlpha = 0.86;
      ctx.fillText(def.sub, cellW / 2, cellH * 0.7);
      ctx.globalAlpha = 1;
    }
    // small painted flourish
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = def.fg;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(56 + i * (cellW - 112) / 2, cellH - 52, 6, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/**
 * Hand-painted rickshaw rear-panel art. Several original motifs are drawn with
 * simple canvas primitives: florals, birds, river scene, cinema-poster style.
 */
export function rickshawArtTexture(style: string, panelColor: string, border = '#e8b25a'): THREE.Texture {
  return cached(`art:${style}:${panelColor}:${border}`, () => {
    const size = 512;
    const { canvas, ctx } = canvas2d(size);
    const rng = mulberry32(style.length * 77);
    ctx.fillStyle = panelColor;
    ctx.fillRect(0, 0, size, size);

    // ornamental border
    ctx.strokeStyle = border;
    ctx.lineWidth = 14;
    ctx.strokeRect(14, 14, size - 28, size - 28);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f6ecd0';
    ctx.strokeRect(30, 30, size - 60, size - 60);
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const x = 22 + t * (size - 44);
      ctx.fillStyle = i % 2 ? border : '#f6ecd0';
      ctx.beginPath();
      ctx.arc(x, 22, 4.5, 0, TAU);
      ctx.arc(x, size - 22, 4.5, 0, TAU);
      ctx.fill();
    }

    const leaf = (cx: number, cy: number, r: number, rot: number, color: string): void => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    };
    const flower = (cx: number, cy: number, r: number, petals: string[], center: string): void => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        leaf(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, r * 0.62, a, petals[i % petals.length]);
      }
      ctx.fillStyle = center;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.34, 0, TAU);
      ctx.fill();
    };
    const vine = (x0: number, y0: number, y1: number): void => {
      ctx.strokeStyle = '#1f7a4b';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let y = y0; y < y1; y += 6) {
        const x = x0 + Math.sin(y / 26) * 16;
        if (y === y0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let y = y0; y < y1; y += 34) {
        leaf(x0 + Math.sin(y / 26) * 16, y, 15, Math.sin(y / 26) * 1.2, '#2f9c63');
      }
    };

    if (style === 'bird') {
      // sky, sun, stylised birds
      const sky = ctx.createLinearGradient(0, 60, 0, size - 60);
      sky.addColorStop(0, '#7fc4e8');
      sky.addColorStop(1, '#e8d9a8');
      ctx.fillStyle = sky;
      ctx.fillRect(40, 40, size - 80, size - 80);
      ctx.fillStyle = '#f7d070';
      ctx.beginPath();
      ctx.arc(size * 0.72, size * 0.3, 42, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#20404a';
      const bird = (bx: number, by: number, s: number): void => {
        ctx.beginPath();
        ctx.moveTo(bx - 26 * s, by);
        ctx.quadraticCurveTo(bx - 10 * s, by - 18 * s, bx, by - 4 * s);
        ctx.quadraticCurveTo(bx + 10 * s, by - 18 * s, bx + 28 * s, by);
        ctx.quadraticCurveTo(bx + 8 * s, by - 4 * s, bx, by + 5 * s);
        ctx.quadraticCurveTo(bx - 8 * s, by - 4 * s, bx - 26 * s, by);
        ctx.fill();
      };
      bird(size * 0.34, size * 0.36, 1);
      bird(size * 0.52, size * 0.28, 0.7);
      bird(size * 0.44, size * 0.52, 0.55);
      flower(size * 0.24, size * 0.74, 40, ['#d63b2f', '#f0a02a'], '#f7d070');
      flower(size * 0.76, size * 0.72, 34, ['#d63b2f', '#f0a02a'], '#f7d070');
      vine(60, 90, size - 90);
      vine(size - 60, 90, size - 90);
    } else if (style === 'river') {
      const sky = ctx.createLinearGradient(0, 40, 0, size * 0.55);
      sky.addColorStop(0, '#2d5f8a');
      sky.addColorStop(1, '#a8d6e8');
      ctx.fillStyle = sky;
      ctx.fillRect(40, 40, size - 80, size * 0.5);
      ctx.fillStyle = '#2b6b5a';
      ctx.fillRect(40, size * 0.52, size - 80, size * 0.42);
      // boat
      ctx.fillStyle = '#5a3418';
      ctx.beginPath();
      ctx.moveTo(size * 0.28, size * 0.7);
      ctx.quadraticCurveTo(size * 0.5, size * 0.82, size * 0.72, size * 0.7);
      ctx.lineTo(size * 0.66, size * 0.66);
      ctx.lineTo(size * 0.34, size * 0.66);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f3e6c8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, size * 0.66);
      ctx.lineTo(size * 0.5, size * 0.52);
      ctx.stroke();
      ctx.fillStyle = '#f3e6c8';
      ctx.beginPath();
      ctx.moveTo(size * 0.5, size * 0.52);
      ctx.lineTo(size * 0.62, size * 0.6);
      ctx.lineTo(size * 0.5, size * 0.62);
      ctx.fill();
      // waves
      ctx.strokeStyle = 'rgba(240,248,255,0.7)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        const y = size * (0.76 + i * 0.035);
        for (let x = 60; x < size - 60; x += 12) {
          ctx.lineTo(x, y + Math.sin(x / 22 + i) * 4);
        }
        ctx.stroke();
      }
      flower(size * 0.2, size * 0.2, 34, ['#e85a4a', '#f7d070'], '#fff0c0');
      flower(size * 0.8, size * 0.24, 28, ['#e85a4a', '#f7d070'], '#fff0c0');
      vine(56, 120, size - 100);
      vine(size - 56, 120, size - 100);
    } else if (style === 'cinema') {
      // invented poster: hero silhouette + rays + invented title text
      ctx.fillStyle = '#5c0f1c';
      ctx.fillRect(40, 40, size - 80, size - 80);
      ctx.save();
      ctx.translate(size / 2, size * 0.56);
      for (let i = 0; i < 24; i++) {
        ctx.rotate(TAU / 24);
        ctx.fillStyle = i % 2 ? 'rgba(240,192,74,0.16)' : 'rgba(240,192,74,0.05)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(240, -32);
        ctx.lineTo(240, 32);
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#1b1016';
      // simple invented villain-free hero bust
      ctx.beginPath();
      ctx.arc(size * 0.5, size * 0.44, 42, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(size * 0.32, size * 0.82);
      ctx.quadraticCurveTo(size * 0.5, size * 0.5, size * 0.68, size * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f0c04a';
      ctx.font = `700 46px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText('মহাকাল', size / 2, size * 0.9);
      flower(size * 0.16, size * 0.16, 26, ['#f0c04a', '#e85a4a'], '#fff0c0');
      flower(size * 0.84, size * 0.16, 26, ['#f0c04a', '#e85a4a'], '#fff0c0');
    } else {
      // floral (default)
      ctx.fillStyle = '#0f6b46';
      ctx.fillRect(40, 40, size - 80, size - 80);
      ctx.save();
      ctx.translate(size / 2, size / 2);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(TAU / 12);
        ctx.fillStyle = i % 2 ? 'rgba(247,208,112,0.14)' : 'rgba(247,208,112,0.05)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(200, -26);
        ctx.lineTo(200, 26);
        ctx.fill();
      }
      ctx.restore();
      flower(size * 0.5, size * 0.5, 78, ['#e85a4a', '#f7d070', '#f0f0e0'], '#c73a2a');
      flower(size * 0.2, size * 0.28, 42, ['#f7d070', '#e85a4a'], '#f6ecd0');
      flower(size * 0.8, size * 0.28, 42, ['#f7d070', '#e85a4a'], '#f6ecd0');
      flower(size * 0.2, size * 0.76, 38, ['#7fc4e8', '#f6ecd0'], '#f7d070');
      flower(size * 0.8, size * 0.76, 38, ['#7fc4e8', '#f6ecd0'], '#f7d070');
      vine(58, 110, size - 110);
      vine(size - 58, 110, size - 110);
      ctx.fillStyle = '#f6ecd0';
      ctx.font = `700 40px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText('ঢাকা', size / 2, size * 0.93);
      void rng;
    }

    // gentle grime so it does not look freshly printed
    for (let i = 0; i < 34; i++) {
      ctx.fillStyle = `rgba(40,26,12,${0.02 + rng() * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(rng() * size, rng() * size, 8 + rng() * 40, 4 + rng() * 22, rng() * TAU, 0, TAU);
      ctx.fill();
    }
    return toTexture(canvas);
  });
}

/** A4-ish wall poster / political-free community notice. */
export function posterTexture(): THREE.Texture {
  return cached('poster', () => {
    const size = 256;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = '#f3ead2';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#b8352a';
    ctx.fillRect(0, 0, size, 54);
    ctx.fillStyle = '#f7f0e3';
    ctx.font = `700 30px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('বিজ্ঞাপন', size / 2, 38);
    ctx.fillStyle = '#2a2a2a';
    ctx.font = `600 22px ${FONT_FAMILY}`;
    ctx.fillText('রিকশা ভাড়া', size / 2, 96);
    ctx.fillText('হবে', size / 2, 126);
    ctx.fillStyle = '#1d5a41';
    ctx.fillRect(28, 148, size - 56, 3);
    ctx.font = `400 17px ${FONT_FAMILY}`;
    ctx.fillText('সকাল ৭টা — রাত ৯টা', size / 2, 178);
    ctx.fillText('মোবাইল: ০১৭...', size / 2, 204);
    ctx.fillStyle = '#e8b25a';
    ctx.beginPath();
    ctx.arc(size / 2, 232, 14, 0, TAU);
    ctx.fill();
    return toTexture(canvas);
  });
}

/** Soft radial sprite used for dust, steam, lamp glow and rain splashes. */
export function radialSprite(inner = 'rgba(255,255,255,0.95)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  return cached(`radial:${inner}:${outer}`, () => {
    const size = 128;
    const { canvas, ctx } = canvas2d(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** Night sky with stars for the sky dome fallback (used when quality is low). */
export function starTexture(): THREE.Texture {
  return cached('stars', () => {
    const size = 512;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, size, size);
    const rng = mulberry32(88);
    for (let i = 0; i < 320; i++) {
      const a = 0.25 + rng() * 0.7;
      ctx.fillStyle = `rgba(220,230,255,${a})`;
      ctx.beginPath();
      ctx.arc(rng() * size, rng() * size, rng() * 1.5 + 0.3, 0, TAU);
      ctx.fill();
    }
    return toTexture(canvas);
  });
}

/** Road paint decal (dashed lines / zebra) — flat white with wear. */
export function paintTexture(): THREE.Texture {
  return cached('paint', () => {
    const size = 128;
    const { canvas, ctx } = canvas2d(size);
    ctx.fillStyle = '#f2eee2';
    ctx.fillRect(0, 0, size, size);
    const rng = mulberry32(64);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(60,60,58,${0.05 + rng() * 0.3})`;
      ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 5, 1 + rng() * 4);
    }
    return toTexture(canvas);
  });
}

/** Vehicle liveries: bus side with fictional operator name. */
export function busLiveryTexture(base: string, accent: string, label: string): THREE.Texture {
  return cached(`bus:${base}:${accent}:${label}`, () => {
    const { canvas, ctx } = canvas2d(512, 128);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 86, 512, 22);
    ctx.fillRect(0, 0, 512, 10);
    for (let x = 20; x < 512; x += 84) {
      ctx.fillStyle = 'rgba(10,20,28,0.72)';
      ctx.beginPath();
      ctx.roundRect(x, 26, 62, 44, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 4, 30, 22, 36);
    }
    ctx.fillStyle = '#fff6e0';
    ctx.font = `700 28px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, 256, 76);
    return toTexture(canvas);
  });
}

/** Adjust anisotropy for a new quality level. */
export function setTextureQuality(anisotropy: number): void {
  for (const tex of txRegistry) {
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
  }
}

export function clearTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

/** Utility exposed for tests / debug: pixel-level sanity of a drawing. */
export function coverage(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit++;
  return clamp01(lit / (canvas.width * canvas.height));
}
