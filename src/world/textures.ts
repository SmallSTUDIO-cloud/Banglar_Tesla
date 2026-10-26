/**
 * Procedural texture generator — crisp, richly detailed Bangladeshi surfaces,
 * signs and rickshaw art with minimal GPU/WebView memory overhead.
 *
 * Key RAM optimization:
 * Instead of retaining dozens of live `<canvas>` + 2D Skia backing stores via
 * `CanvasTexture`, static procedural textures are rasterised on a single shared
 * scratch `<canvas>` and uploaded as compact `THREE.DataTexture` buffers, after
 * which the scratch canvas is shrunk to 1x1. `SignAtlas` uses a crisp 1024x1024
 * sheet (packing 64 Bengali shop signs at 128x128 / 256x128 slots) rather than
 * 2048x2048, saving ~36 MB of combined RGBA + mipmap + Skia memory.
 */

import * as THREE from 'three';
import { mulberry32 } from '../core/mathx';

const cache = new Map<string, THREE.Texture>();
let maxAnisotropy = 4;
let sharedScratchCanvas: HTMLCanvasElement | null = null;

export function setTextureQuality(anisotropy: number): void {
  maxAnisotropy = anisotropy;
  for (const tex of cache.values()) {
    tex.anisotropy = maxAnisotropy;
  }
}

function getScratchContext(width: number, height: number): CanvasRenderingContext2D {
  if (!sharedScratchCanvas) {
    sharedScratchCanvas = document.createElement('canvas');
  }
  sharedScratchCanvas.width = width;
  sharedScratchCanvas.height = height;
  const ctx = sharedScratchCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export function releaseScratchCanvas(): void {
  if (sharedScratchCanvas) {
    sharedScratchCanvas.width = 1;
    sharedScratchCanvas.height = 1;
  }
}

function makeTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { repeat?: [number, number]; srgb?: boolean; mipmaps?: boolean } = {},
): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;

  if (typeof document === 'undefined') {
    const fallbackBytes = new Uint8Array([220, 220, 220, 255]);
    const fallbackTex = new THREE.DataTexture(fallbackBytes, 1, 1, THREE.RGBAFormat);
    fallbackTex.needsUpdate = true;
    cache.set(key, fallbackTex);
    return fallbackTex;
  }

  const ctx = getScratchContext(width, height);
  draw(ctx, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  releaseScratchCanvas();

  const bytes = new Uint8Array(imageData.data.buffer);
  const tex = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  tex.flipY = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const useMips = opts.mipmaps !== false;
  tex.generateMipmaps = useMips;
  tex.minFilter = useMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/* ----------------------------------------------------------- road + ground */

export function asphaltTexture(): { map: THREE.Texture; rough: THREE.Texture } {
  const map = makeTexture(
    'asphalt.map',
    256,
    256,
    (ctx, w, h) => {
      const rng = mulberry32(101);
      ctx.fillStyle = '#2d3136';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 6500; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const v = 34 + Math.floor(rng() * 34);
        ctx.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
        ctx.fillRect(x, y, rng() < 0.25 ? 2 : 1, 1);
      }
      // Subtle patched bitumen + tyre polish bands
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(20,22,26,${0.12 + rng() * 0.14})`;
        ctx.beginPath();
        ctx.ellipse(rng() * w, rng() * h, 14 + rng() * 34, 8 + rng() * 20, rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(15,17,20,0.42)';
      ctx.lineWidth = 1;
      for (let c = 0; c < 6; c++) {
        ctx.beginPath();
        let x = rng() * w;
        let y = rng() * h;
        ctx.moveTo(x, y);
        for (let s = 0; s < 7; s++) {
          x += (rng() - 0.5) * 26;
          y += (rng() - 0.5) * 26;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    { repeat: [1, 1] },
  );

  const rough = makeTexture(
    'asphalt.rough',
    128,
    128,
    (ctx, w, h) => {
      const rng = mulberry32(202);
      ctx.fillStyle = '#c4c4c4';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) {
        const g = 135 + Math.floor(rng() * 105);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(rng() * w, rng() * h, 2, 2);
      }
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = 'rgba(55,55,55,0.5)';
        ctx.beginPath();
        ctx.ellipse(rng() * w, rng() * h, 8 + rng() * 20, 6 + rng() * 14, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { srgb: false },
  );

  return { map, rough };
}

export function sidewalkTexture(): THREE.Texture {
  return makeTexture('sidewalk', 256, 256, (ctx, w, h) => {
    const rng = mulberry32(303);
    ctx.fillStyle = '#8b8375';
    ctx.fillRect(0, 0, w, h);
    const tile = 32;
    for (let y = 0; y < h; y += tile) {
      for (let x = 0; x < w; x += tile) {
        const shade = -12 + Math.floor(rng() * 24);
        const r = 138 + shade;
        const g = 130 + shade;
        const b = 116 + shade;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
      }
    }
    ctx.strokeStyle = 'rgba(42,38,32,0.52)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i <= w; i += tile) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(w, i);
      ctx.stroke();
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(38,44,32,${rng() * 0.2})`;
      ctx.fillRect(rng() * w, rng() * h, 2, 2);
    }
  });
}

/* --------------------------------------------------------------- buildings */

export function plasterFacadeTexture(variant: number, tint: string): THREE.Texture {
  return makeTexture(`facade.${variant}.${tint}`, 256, 256, (ctx, w, h) => {
    const rng = mulberry32(700 + variant * 37);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);

    // Monsoon damp streaks & weathered concrete patina
    for (let i = 0; i < 65; i++) {
      const x = rng() * w;
      const len = 24 + rng() * 110;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(28,32,26,${0.08 + rng() * 0.14})`);
      g.addColorStop(1, 'rgba(28,32,26,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, rng() * (h * 0.55), 1 + rng() * 3.5, len);
    }
    for (let i = 0; i < 1400; i++) {
      const a = rng() * 0.08;
      ctx.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(18,16,14,${a})`;
      ctx.fillRect(rng() * w, rng() * h, 2, 2);
    }

    // 4 floors × 4 window bays with security grilles + shutters + AC ledges
    const cols = 4;
    const rows = 4;
    const padX = 12;
    const padY = 12;
    const cellW = (w - padX * 2) / cols;
    const cellH = (h - padY * 2) / rows;
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = 'rgba(36,32,28,0.28)';
      ctx.fillRect(0, padY + r * cellH - 2, w, 2.5);
      for (let c = 0; c < cols; c++) {
        const wx = padX + c * cellW + cellW * 0.15;
        const wy = padY + r * cellH + cellH * 0.16;
        const ww = cellW * 0.7;
        const wh = cellH * 0.62;
        ctx.fillStyle = 'rgba(28,24,20,0.48)';
        ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
        const lit = rng() < 0.42;
        ctx.fillStyle = lit ? '#604b2d' : '#1b262d';
        ctx.fillRect(wx, wy, ww, wh);
        // Bangladeshi iron window grille bars
        ctx.strokeStyle = 'rgba(210,208,198,0.42)';
        ctx.lineWidth = 1;
        ctx.strokeRect(wx + 1, wy + 1, ww - 2, wh - 2);
        for (let b = 1; b <= 3; b++) {
          const bx = wx + (ww * b) / 4;
          ctx.beginPath();
          ctx.moveTo(bx, wy);
          ctx.lineTo(bx, wy + wh);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(wx, wy + wh * 0.5);
        ctx.lineTo(wx + ww, wy + wh * 0.5);
        ctx.stroke();
        // Sunshade chajja lintel above window
        ctx.fillStyle = 'rgba(55,50,44,0.62)';
        ctx.fillRect(wx - 3, wy - 4, ww + 6, 3);
      }
    }
  });
}

export function brickTexture(): THREE.Texture {
  return makeTexture('brick', 128, 128, (ctx, w, h) => {
    const rng = mulberry32(909);
    ctx.fillStyle = '#7e3c2c';
    ctx.fillRect(0, 0, w, h);
    const bh = 8;
    const bw = 22;
    for (let row = 0, y = 0; y < h; row++, y += bh) {
      const off = (row % 2) * (bw / 2);
      for (let x = -bw; x < w + bw; x += bw) {
        const d = Math.floor((rng() - 0.5) * 28);
        ctx.fillStyle = `rgb(${132 + d},${62 + Math.floor(d * 0.5)},${45 + Math.floor(d * 0.4)})`;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  });
}

export function shutterTexture(): THREE.Texture {
  return makeTexture('shutter', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#47545e';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 5) {
      ctx.fillStyle = y % 10 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.24)';
      ctx.fillRect(0, y, w, 2);
    }
    ctx.fillStyle = 'rgba(92,54,28,0.24)';
    ctx.fillRect(0, h - 18, w, 18);
  });
}

/* ----------------------------------------------------- Bangla signboards */

export interface SignSlot {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface SignSpec {
  title: string;
  sub?: string;
  bg: string;
  fg: string;
  accent: string;
}

export const SHOP_SIGNS: SignSpec[] = [
  { title: 'টাউন হল কাঁচা বাজার', sub: 'টাটকা মাছ ও সবজি', bg: '#125c42', fg: '#fff6dc', accent: '#f4c04a' },
  { title: 'বিসমিল্লাহ চায়ের টং', sub: 'দুধ চা · মালাই চা · বিস্কুট', bg: '#7a1f24', fg: '#ffe9b8', accent: '#ffd25a' },
  { title: 'মামা স্পেশাল ফুচকা', sub: 'চটপটি ও তেঁতুল পানি', bg: '#8a1c4a', fg: '#fff4d4', accent: '#ffd166' },
  { title: 'ঢাকাইয়া ঝালমুড়ি', sub: 'সরিষার তেল ও মশলা মুড়ি', bg: '#a33b16', fg: '#fff8df', accent: '#ffda66' },
  { title: 'আসাদ এভেনিউ ফার্মেসি', sub: 'ওষুধ ও প্রাথমিক চিকিৎসা', bg: '#15556e', fg: '#e9fbff', accent: '#5fe0b0' },
  { title: 'মোহাম্মদপুর বিরিয়ানি ঘর', sub: 'কাচ্চি · তেহারি · বোরহানি', bg: '#8c2d19', fg: '#fff1d0', accent: '#f7b733' },
  { title: 'নূরজাহান বই ও স্টেশনারি', sub: 'খাতা · কলম · গল্পের বই', bg: '#3e2a56', fg: '#f8ecff', accent: '#f3b562' },
  { title: 'শেরশাহ রিকশা ওয়ার্কশপ', sub: 'টায়ার · ব্রেক · ব্যাটারি চার্জ', bg: '#20323d', fg: '#f5e8c8', accent: '#e8824a' },
  { title: 'জনতা হার্ডওয়্যার', sub: 'রং · তার · পাইপ ফিটিংস', bg: '#1f4a2e', fg: '#f4f0dc', accent: '#e8b25a' },
  { title: 'তাজমহল বেকারি ও সুইটস', sub: 'মিষ্টি · দই · গরম সমুচা', bg: '#9b3a26', fg: '#fff4df', accent: '#ffd27a' },
  { title: 'সলিমুল্লাহ টেইলার্স', sub: 'পাঞ্জাবি · শার্ট · সেলাই', bg: '#1b3a6b', fg: '#eaf2ff', accent: '#f5c258' },
  { title: 'ভাই ভাই ফল ভাণ্ডার', sub: 'আম · কলা · পেঁপে · ডাব', bg: '#2f5e24', fg: '#f6f3dc', accent: '#f4a93b' },
  { title: 'বাবর রোড মোবাইল পয়েন্ট', sub: 'ফ্লেক্সিলোড · বিকাশ · সার্ভিসিং', bg: '#6a1b4d', fg: '#ffeaf7', accent: '#ffbe55' },
  { title: 'ইকবাল রোড ফটো স্টুডিও', sub: 'পাসপোর্ট ছবি ও ফটোকপি', bg: '#223b54', fg: '#f0f7ff', accent: '#62d2a2' },
  { title: 'মদিনা জেনারেল স্টোর', sub: 'চাল · ডাল · তেল · মসলা', bg: '#4f321c', fg: '#fff3d6', accent: '#f0b64c' },
  { title: 'শিয়া মসজিদ মোড় লন্ড্রি', sub: 'ড্রাই ক্লিন ও ইস্ত্রি', bg: '#17565c', fg: '#eaffff', accent: '#ffd166' },
];

/**
 * Compact 1024x512 signboard atlas (16 crisp 256x128 Bangla signboards).
 * Uses only ~2 MB of RGBA memory instead of 16+ MB for 2048x2048!
 */
export class SignAtlas {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private slots: SignSlot[] = [];
  private cols = 4;
  private rows = 4;
  private cellW = 256;
  private cellH = 128;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols * this.cellW; // 1024
    this.canvas.height = this.rows * this.cellH; // 512
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = maxAnisotropy;
    this.redrawAll();
  }

  redrawAll(): void {
    this.slots = [];
    this.ctx.fillStyle = '#181818';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let i = 0; i < this.cols * this.rows; i++) {
      const spec = SHOP_SIGNS[i % SHOP_SIGNS.length];
      this.drawCell(i, spec);
    }
    this.texture.needsUpdate = true;
  }

  private drawCell(index: number, spec: SignSpec): void {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const x = col * this.cellW;
    const y = row * this.cellH;
    const w = this.cellW;
    const h = this.cellH;
    const ctx = this.ctx;

    ctx.fillStyle = spec.bg;
    ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 7, y + 7, w - 14, h - 14);
    ctx.strokeStyle = spec.fg;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);

    ctx.fillStyle = spec.accent;
    for (const [cx, cy] of [
      [x + 16, y + 16],
      [x + w - 16, y + 16],
      [x + 16, y + h - 16],
      [x + w - 16, y + h - 16],
    ]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = spec.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 24px "Hind Siliguri", "Noto Sans Bengali", sans-serif';
    ctx.fillText(spec.title, x + w / 2, y + (spec.sub ? h * 0.43 : h * 0.52), w - 34);
    if (spec.sub) {
      ctx.fillStyle = spec.accent;
      ctx.font = '600 15px "Hind Siliguri", "Noto Sans Bengali", sans-serif';
      ctx.fillText(spec.sub, x + w / 2, y + h * 0.74, w - 34);
    }

    const ch = this.canvas.height;
    this.slots[index] = {
      u0: (x + 3) / this.canvas.width,
      v0: 1 - (y + h - 3) / ch,
      u1: (x + w - 3) / this.canvas.width,
      v1: 1 - (y + 3) / ch,
    };
  }

  slot(index: number): SignSlot {
    return this.slots[((index % this.slots.length) + this.slots.length) % this.slots.length];
  }

  get count(): number {
    return this.slots.length;
  }
}

/* ------------------------------------------------------- rickshaw panel art */

/**
 * Traditional hand-painted Bangladeshi rickshaw tin backplate art!
 * Cached safely in `cache` — callers MUST NOT dispose this shared texture.
 */
export function rickshawArtTexture(motif: string, primary: string, secondary: string): THREE.Texture {
  return makeTexture(
    `art.${motif}.${primary}.${secondary}`,
    256,
    192,
    (ctx, w, h) => {
      ctx.fillStyle = primary;
      ctx.fillRect(0, 0, w, h);

      // Ornate scalloped multi-border frame
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 8;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.strokeStyle = '#fff5d6';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(14, 14, w - 28, h - 28);

      for (let x = 22; x < w - 18; x += 14) {
        ctx.fillStyle = x % 28 === 8 ? '#ff4655' : '#35d49a';
        ctx.beginPath();
        ctx.arc(x, 10, 3.2, 0, Math.PI * 2);
        ctx.arc(x, h - 10, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const cx = w / 2;
      const cy = h / 2 + 4;
      const petal = (px: number, py: number, r: number, count: number, color: string, inner: string): void => {
        ctx.save();
        ctx.translate(px, py);
        for (let i = 0; i < count; i++) {
          ctx.rotate((Math.PI * 2) / count);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(0, -r * 0.56, r * 0.25, r * 0.52, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      if (motif === 'bird') {
        // Twin folk peacocks flanking a lotus
        for (const dir of [-1, 1]) {
          ctx.save();
          ctx.translate(cx + dir * 56, cy + 4);
          ctx.scale(dir, 1);
          ctx.fillStyle = '#ffd65c';
          ctx.beginPath();
          ctx.ellipse(0, 0, 26, 15, -0.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1f9d8b';
          ctx.beginPath();
          ctx.arc(20, -14, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ff5c4d';
          ctx.beginPath();
          ctx.moveTo(28, -14);
          ctx.lineTo(39, -11);
          ctx.lineTo(28, -8);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        petal(cx, cy - 6, 30, 10, '#ff6b6b', '#fff0a6');
      } else if (motif === 'river') {
        const g = ctx.createLinearGradient(0, 18, 0, h - 18);
        g.addColorStop(0, '#ff9a52');
        g.addColorStop(0.52, '#ffd68a');
        g.addColorStop(0.55, '#1b6f8a');
        g.addColorStop(1, '#0e3c52');
        ctx.fillStyle = g;
        ctx.fillRect(18, 18, w - 36, h - 36);
        ctx.fillStyle = '#fff0a8';
        ctx.beginPath();
        ctx.arc(cx, h * 0.42, 20, 0, Math.PI * 2);
        ctx.fill();
        // Country nouka boat with colourful sail
        ctx.fillStyle = '#2a160c';
        ctx.beginPath();
        ctx.moveTo(cx - 56, h * 0.68);
        ctx.quadraticCurveTo(cx, h * 0.84, cx + 56, h * 0.68);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f25c4d';
        ctx.beginPath();
        ctx.moveTo(cx - 6, h * 0.68);
        ctx.lineTo(cx - 6, h * 0.32);
        ctx.lineTo(cx + 32, h * 0.62);
        ctx.closePath();
        ctx.fill();
      } else if (motif === 'cinema' || motif === 'tiger') {
        const rg = ctx.createRadialGradient(cx, cy, 8, cx, cy, 120);
        rg.addColorStop(0, '#ffe47a');
        rg.addColorStop(1, primary);
        ctx.fillStyle = rg;
        ctx.fillRect(18, 18, w - 36, h - 36);
        ctx.save();
        ctx.translate(cx, cy);
        for (let i = 0; i < 16; i++) {
          ctx.rotate((Math.PI * 2) / 16);
          ctx.fillStyle = i % 2 === 0 ? 'rgba(255,92,77,0.52)' : 'rgba(36,198,168,0.42)';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-10, -110);
          ctx.lineTo(10, -110);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        if (motif === 'tiger') {
          // Stylized Royal Bengal Tiger emblem
          ctx.fillStyle = '#f59c24';
          ctx.beginPath();
          ctx.arc(cx, cy + 2, 34, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1b1410';
          for (const dy of [-14, -4, 6]) {
            ctx.fillRect(cx - 28, cy + dy, 14, 4);
            ctx.fillRect(cx + 14, cy + dy, 14, 4);
          }
          ctx.fillStyle = '#fff8e7';
          ctx.beginPath();
          ctx.arc(cx - 11, cy - 5, 5, 0, Math.PI * 2);
          ctx.arc(cx + 11, cy - 5, 5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          petal(52, 50, 22, 8, '#ff5c7a', '#ffe88a');
          petal(w - 52, 50, 22, 8, '#ff5c7a', '#ffe88a');
        }
      } else {
        // Classic Shapla / Lotus & Marigold Rickshaw Art
        petal(cx, cy + 4, 46, 12, '#ff4d5e', '#ffe066');
        petal(54, 52, 24, 8, '#38c695', '#fff2a6');
        petal(w - 54, 52, 24, 8, '#38c695', '#fff2a6');
        petal(54, h - 46, 22, 8, '#ffa93a', '#fff2a6');
        petal(w - 54, h - 46, 22, 8, '#ffa93a', '#fff2a6');
      }

      // Traditional top ribbon banner ("মা-বাবার দোয়া" / "বাংলার টেসলা")
      ctx.fillStyle = '#10261e';
      ctx.fillRect(cx - 74, 20, 148, 24);
      ctx.strokeStyle = '#ffd65c';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 74, 20, 148, 24);
      ctx.fillStyle = '#fff5d6';
      ctx.font = '700 15px "Hind Siliguri", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('বাংলার টেসলা · ঢাকা', cx, 32);
    },
    { repeat: [1, 1], mipmaps: false },
  );
}

export const FONT_FAMILY = '"Hind Siliguri", "Noto Sans Bengali", system-ui, sans-serif';

export function radialSprite(inner = 'rgba(255,220,160,0.9)', outer = 'rgba(255,200,120,0)'): THREE.Texture {
  return makeTexture(
    `radial.${inner}.${outer}`,
    64,
    64,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { mipmaps: false },
  );
}

export function clothTexture(): THREE.Texture {
  return makeTexture('cloth', 64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#d9d5cc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
  });
}

export function posterTexture(): THREE.Texture {
  return makeTexture('poster', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#efe2c0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b32821';
    ctx.fillRect(8, 8, w - 16, 30);
    ctx.fillStyle = '#fff5dc';
    ctx.font = `700 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('মোহাম্মদপুর মেলা', w / 2, 28);
    ctx.fillStyle = '#1b4d3e';
    ctx.fillRect(14, 46, w - 28, 42);
    ctx.fillStyle = '#ffd166';
    ctx.font = `700 14px ${FONT_FAMILY}`;
    ctx.fillText('টাউন হল মাঠ', w / 2, 72);
    ctx.fillStyle = '#2d241c';
    ctx.fillRect(18, 96, w - 36, 8);
    ctx.fillRect(28, 110, w - 56, 6);
  });
}

export function disposeTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
  releaseScratchCanvas();
}
