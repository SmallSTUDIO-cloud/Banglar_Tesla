/**
 * Inline SVG icon set. Using SVG (instead of emoji) keeps the UI identical on
 * every Android device and in headless test browsers.
 */

const svg = (body: string, size = 24): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  rickshaw: svg(
    `<circle cx="7.5" cy="17.2" r="3.1"/><circle cx="16.6" cy="17.2" r="2.5"/><path d="M10 17.2h4.1"/><path d="M7.5 17.2 9.6 9h4.2l-1.3 6.2"/><path d="M9.6 9 8.2 5.4h3.4"/><path d="M14.8 9.6c2.3-.6 3.6.6 4 2.6"/><path d="M12.2 12.4h3.2"/>`,
    26,
  ),
  compass: svg(`<circle cx="12" cy="12" r="8.4"/><path d="M14.8 9.2l-1.5 4.1-4.1 1.5 1.5-4.1z"/>`, 26),
  calendar: svg(
    `<rect x="3.6" y="5" width="16.8" height="15" rx="2.4"/><path d="M3.6 9.6h16.8M8.2 3.4v3.2M15.8 3.4v3.2"/><path d="M7.4 13.2h2.2M11 13.2h2.2M14.6 13.2h2.2M7.4 16.6h2.2M11 16.6h2.2"/>`,
    26,
  ),
  bell: svg(
    `<path d="M6.4 16.4c1-1.1 1.2-2.2 1.2-4.2 0-2.6 1.7-4.6 4.4-4.6s4.4 2 4.4 4.6c0 2 .2 3.1 1.2 4.2z"/><path d="M10.2 18.6a1.9 1.9 0 0 0 3.6 0"/><path d="M12 5.2V3.6"/>`,
  ),
  camera: svg(
    `<rect x="3" y="7.4" width="12.2" height="9.6" rx="2.2"/><path d="M15.2 11.2l5.2-2.8v7.6l-5.2-2.8z"/><circle cx="8.4" cy="12.2" r="1.9"/>`,
  ),
  pause: svg(`<path d="M9.4 6v12M14.6 6v12" stroke-width="2.4"/>`),
  close: svg(`<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" stroke-width="2"/>`),
  gear: svg(
    `<circle cx="12" cy="12" r="3.1"/><path d="M12 3.2v2M12 18.8v2M4.8 12h2M17.2 12h2M6.9 6.9l1.4 1.4M15.7 15.7l1.4 1.4M17.1 6.9l-1.4 1.4M8.3 15.7l-1.4 1.4"/>`,
  ),
  wrench: svg(
    `<path d="M14.6 4.6a4.2 4.2 0 0 0-5.2 5.2L4.6 14.6a2.2 2.2 0 0 0 3.1 3.1l4.8-4.8a4.2 4.2 0 0 0 5.2-5.2l-2.4 2.4-2.3-2.3z"/>`,
  ),
  paint: svg(
    `<path d="M5 11.2c0-3.3 3.1-5.6 7-5.6s7 2.3 7 5.6c0 2.2-1.5 3.6-3.4 4v2.2a1.8 1.8 0 0 1-3.6 0v-2.2c-4-.3-7-1.7-7-4z"/><circle cx="9.4" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="12.4" cy="8.6" r=".9" fill="currentColor" stroke="none"/><circle cx="15.2" cy="10.2" r=".9" fill="currentColor" stroke="none"/>`,
  ),
  cart: svg(
    `<path d="M3.4 5.2h2.2l2.4 9.6h9.4l2.2-7.2H7"/><circle cx="9" cy="18.4" r="1.4"/><circle cx="16.6" cy="18.4" r="1.4"/>`,
  ),
  arrowLeft: svg(`<path d="M14.4 5.6 8 12l6.4 6.4" stroke-width="2.2"/>`),
  arrowRight: svg(`<path d="M9.6 5.6 16 12l-6.4 6.4" stroke-width="2.2"/>`),
  coin: svg(`<circle cx="12" cy="12" r="8.2"/><path d="M9.6 9.2h3.4a1.9 1.9 0 0 1 0 3.8H9.6m0 0h4.8M11.6 6.6v10.8" stroke-width="1.5"/>`),
  trophy: svg(
    `<path d="M8.2 4.4h7.6v4.2a3.8 3.8 0 0 1-7.6 0z"/><path d="M8.2 5.6H5.4v1.6a3 3 0 0 0 2.8 3M15.8 5.6h2.8v1.6a3 3 0 0 1-2.8 3"/><path d="M12 12.4v3.2M9.2 19.6h5.6l-.6-3.4h-4.4z"/>`,
  ),
  play: svg(`<path d="M8.4 5.6 18 12l-9.6 6.4z" fill="currentColor" stroke="none"/>`),
  slow: svg(`<path d="M12 4.4a7.6 7.6 0 1 0 7.6 7.6"/><path d="M12 8.4V12l2.8 1.8"/>`, 22),
  route: svg(`<circle cx="6.2" cy="17.8" r="2.2"/><circle cx="17.8" cy="6.2" r="2.2"/><path d="M8.4 17.8h4.2a3 3 0 0 0 0-6H9.4a3 3 0 0 1 0-5.6h4.2"/>`, 22),
  check: svg(`<path d="M5.4 12.6l4.2 4.2 9-9.6" stroke-width="2.2"/>`),
} as const;

export function icon(name: keyof typeof ICONS): HTMLElement {
  const span = document.createElement('span');
  span.className = `icon icon-${name}`;
  span.innerHTML = ICONS[name];
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.justifyContent = 'center';
  return span;
}
