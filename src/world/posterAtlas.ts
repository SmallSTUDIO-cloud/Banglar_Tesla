import * as THREE from 'three';
import type { UvRect } from './geo';

/** Original, in-game Bengali poster art (not copied logos or campaign photos).
 * A single 1024×512 RGBA atlas serves four paper designs and two roadside
 * billboards. The civic notice is deliberately non-partisan and uncommon. */
export class PosterAtlas {
  readonly texture: THREE.CanvasTexture;
  private readonly paper: UvRect[] = [];
  private readonly boards: UvRect[] = [];

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const font = '"Hind Siliguri", "Noto Sans Bengali", sans-serif';
    const slot = (x: number, y: number, w: number, h: number): UvRect => ({
      u0: (x + 2) / 1024, u1: (x + w - 2) / 1024,
      v0: 1 - (y + h - 2) / 512, v1: 1 - (y + 2) / 512,
    });
    const specs = [
      { name: 'উদ্ভাস', headline: 'ভর্তি প্রস্তুতি', sub: 'প্রশ্ন অনুশীলন • মডেল টেস্ট', foot: 'পড়াশোনায় এগিয়ে চলো', bg: '#f1cf38', ink: '#203756', accent: '#cf4435' },
      { name: 'মোহাম্মদপুর', headline: 'বই ও খাতা', sub: 'পড়ার সঙ্গী প্রতিদিন', foot: 'শিক্ষা • বই • স্টেশনারি', bg: '#e5eee1', ink: '#244c40', accent: '#be653a' },
      { name: 'পরিচ্ছন্ন শহর', headline: 'আমাদের দায়িত্ব', sub: 'ময়লা রাখুন নির্দিষ্ট স্থানে', foot: 'পরিবেশ সচেতনতা', bg: '#d6e8dc', ink: '#245a50', accent: '#b6a143' },
      { name: 'নির্বাচন', headline: 'সচেতন নাগরিক', sub: 'তথ্য জানুন • শান্তি বজায় রাখুন', foot: 'নিরপেক্ষ নাগরিক বার্তা', bg: '#f0e6d7', ink: '#493956', accent: '#ae4e54' },
    ];
    specs.forEach((s, i) => {
      const x = i * 256, y = 0;
      ctx.fillStyle = s.bg; ctx.fillRect(x, y, 256, 256);
      ctx.fillStyle = s.ink; ctx.fillRect(x + 8, y + 8, 240, 8);
      ctx.fillStyle = s.accent; ctx.fillRect(x + 8, y + 18, 240, 3);
      ctx.fillStyle = s.accent;
      ctx.beginPath(); ctx.arc(x + 128, y + 76, 36, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = s.bg; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x + 109, y + 80); ctx.lineTo(x + 128, y + 66); ctx.lineTo(x + 147, y + 80); ctx.stroke();
      ctx.fillStyle = s.ink; ctx.font = `700 23px ${font}`; ctx.textAlign = 'center';
      ctx.fillText(s.name, x + 128, y + 44, 232);
      ctx.fillStyle = s.ink; ctx.font = `800 29px ${font}`;
      ctx.fillText(s.headline, x + 128, y + 143, 234);
      ctx.fillStyle = s.accent; ctx.fillRect(x + 29, y + 153, 198, 3);
      ctx.fillStyle = s.ink; ctx.font = `600 16px ${font}`;
      ctx.fillText(s.sub, x + 128, y + 185, 238);
      ctx.fillStyle = s.accent; ctx.fillRect(x + 8, y + 209, 240, 34);
      ctx.fillStyle = '#fff9ec'; ctx.font = `700 14px ${font}`;
      ctx.fillText(s.foot, x + 128, y + 231, 232);
      // Misregistered paper ink, small corner ticks and cream edge increase
      // street-print character without any external brand artwork.
      ctx.strokeStyle = '#fff8e8'; ctx.lineWidth = 2; ctx.strokeRect(x + 4, y + 4, 248, 248);
      for (const cx of [x + 18, x + 238]) for (const cy of [y + 34, y + 196]) {
        ctx.fillStyle = '#a39b8f'; ctx.fillRect(cx, cy, 2, 4);
      }
      this.paper.push(slot(x, y, 256, 256));
    });
    const boards = [
      { bg: '#e5c537', stripe: '#b93838', head: 'উদ্ভাস', line: 'ভর্তি পরীক্ষার প্রস্তুতি', foot: 'অনুশীলন • পরীক্ষা • এগিয়ে চলা' },
      { bg: '#234d49', stripe: '#dfaa57', head: 'মোহাম্মদপুর', line: 'বাজার ও পাড়া-মহল্লা', foot: 'আপনার শহর • আপনার পথ' },
    ];
    boards.forEach((s, i) => {
      const x = i * 512, y = 256;
      ctx.fillStyle = s.bg; ctx.fillRect(x, y, 512, 256);
      ctx.fillStyle = s.stripe; ctx.fillRect(x + 8, y + 8, 496, 16);
      ctx.fillRect(x + 8, y + 225, 496, 21);
      ctx.strokeStyle = '#f6e9cf'; ctx.lineWidth = 4; ctx.strokeRect(x + 13, y + 29, 486, 189);
      ctx.fillStyle = '#fff9ed'; ctx.textAlign = 'center';
      ctx.font = `800 47px ${font}`; ctx.fillText(s.head, x + 256, y + 99, 470);
      ctx.font = `700 30px ${font}`; ctx.fillText(s.line, x + 256, y + 154, 470);
      ctx.font = `600 19px ${font}`; ctx.fillText(s.foot, x + 256, y + 200, 470);
      this.boards.push(slot(x, y, 512, 256));
    });
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }

  poster(index: number): UvRect { return this.paper[((index % 4) + 4) % 4]; }
  billboard(index: number): UvRect { return this.boards[((index % 2) + 2) % 2]; }
  dispose(): void { this.texture.dispose(); }
}
