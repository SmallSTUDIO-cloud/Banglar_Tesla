import * as THREE from 'three';
import type { UvRect } from './geo';

/** User-supplied SSC MCQ Star 2020 and HSC'25 admission posters, packed at
 * native-ish resolution in ONE 1024x2048 texture. No hotlinked images, per
 * poster materials, animated canvases or per-frame texture uploads. */
export const EDUCATION_POSTERS: readonly UvRect[] = [
  { u0: 1 / 1024, u1: 1023 / 1024, v0: 1 - 1451 / 2048, v1: 1 - 1 / 2048 },
  { u0: 1 / 1024, u1: 553 / 1024, v0: 1 - 2025 / 2048, v1: 1 - 1473 / 2048 },
];

export function educationPosterTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}posters/mohammadpur-education.webp`,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

/** Original illustrated packets; nearby Bengali words stay legible without
 * using real brands. Four variants share a tiny canvas texture and mesh pass. */
export function snackPacketAtlas(): { texture: THREE.CanvasTexture; slots: UvRect[] } {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const slots: UvRect[] = [];
  const colors = [
    ['#d64524', '#ffdc3c', 'ঝাল চিপস'],
    ['#276c49', '#ffe4a1', 'মজার চিপস'],
    ['#e6a52e', '#4c2d26', 'নিমকি'],
    ['#2856a0', '#f9e7b6', 'চানাচুর'],
  ];
  colors.forEach(([bg, ink, title], i) => {
    const x = i * 128;
    ctx.fillStyle = bg; ctx.fillRect(x, 0, 128, 256);
    ctx.fillStyle = '#fff6d7'; ctx.fillRect(x + 4, 5, 120, 12);
    ctx.fillRect(x + 4, 238, 120, 12);
    ctx.fillStyle = ink; ctx.fillRect(x + 10, 25, 108, 202);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(x + 64, 94, 38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff7e2'; ctx.textAlign = 'center';
    ctx.font = 'bold 27px "Hind Siliguri", sans-serif';
    ctx.fillText(title, x + 64, 169, 110);
    ctx.font = 'bold 14px "Hind Siliguri", sans-serif';
    ctx.fillText('মুদি দোকান', x + 64, 203, 110);
    // Crimped-foil stripes, seal and a narrow specular fold (opaque material).
    ctx.fillStyle = '#ffffff66'; ctx.fillRect(x + 17, 20, 8, 207);
    for (let p = 0; p < 8; p++) {
      ctx.fillStyle = p % 2 ? '#ffffff99' : bg;
      ctx.fillRect(x + 8 + p * 15, 242, 8, 4);
    }
    slots.push({ u0: (x + 2) / 512, u1: (x + 126) / 512,
      v0: 1 - 254 / 256, v1: 1 - 2 / 256 });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, slots };
}
