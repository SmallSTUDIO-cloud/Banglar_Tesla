/**
 * Minimal DOM shim so `buildCity()` can run outside a browser.
 *
 * `buildCity` is pure world generation except that it paints sign and asphalt
 * textures through a 2D canvas. Without a DOM it throws
 * `document is not defined`, so the generated world — and therefore the building
 * baseline — could only be observed in a real browser.
 *
 * This shim provides just enough of `document.createElement('canvas')` and the
 * 2D context for generation to complete. **It draws nothing**: every canvas call
 * is a no-op and `getImageData` returns a zeroed buffer. That is deliberate and
 * safe here because building *placement* reads only segment geometry and the
 * seeded RNG (`mulberry32(20261207)`), never a pixel. Verified by the resulting
 * 845 buildings matching the count reported by the browser-based
 * `tests/e2e/verify-geography.mjs`.
 *
 * It is a **test/tooling** shim and is never imported by application code.
 */

type AnyRecord = Record<string, unknown>;

function makeContext(canvas: AnyRecord): AnyRecord {
  const gradient = () => ({ addColorStop() {} });
  const handler: ProxyHandler<AnyRecord> = {
    get(_target, prop: string | symbol) {
      if (prop === 'canvas') return canvas;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return gradient;
      if (prop === 'createPattern') return () => null;
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(4, Math.abs(w * h * 4))),
          width: w,
          height: h,
        });
      }
      if (prop === 'createImageData') {
        return (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
      }
      // Anything not explicitly handled is a no-op drawing call.
      return () => undefined;
    },
    set() {
      return true;
    },
  };
  return new Proxy({} as AnyRecord, handler);
}

function makeElement(tag: string): AnyRecord {
  const element: AnyRecord = {
    tagName: tag.toUpperCase(),
    width: 1024,
    height: 1024,
    src: '',
    crossOrigin: null,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    toDataURL() {
      return 'data:,';
    },
  };
  element.getContext = () => makeContext(element);
  return element;
}

let installed = false;

/**
 * Install the shim on `globalThis`. Idempotent: calling twice is a no-op.
 * Must be called *before* importing `src/world/city.ts` (use a dynamic import).
 */
export function installDomShim(): void {
  if (installed) return;
  const g = globalThis as unknown as AnyRecord;
  const doc: AnyRecord = {
    createElement: (tag: string) => makeElement(tag),
    createElementNS: (_ns: string, tag: string) => makeElement(tag),
    documentElement: makeElement('html'),
    body: makeElement('body'),
  };
  g.document = doc;
  if (!g.window) g.window = g;
  installed = true;
}

/** True once the shim is in place, so tests can assert setup happened. */
export function isDomShimInstalled(): boolean {
  return installed;
}
