// Cached writes to the document for the instrument's per-frame motion: a value is written only when it has changed (opacities
// to a hundredth, which the eye cannot tell from the exact number), so a part that is standing still costs nothing. Every
// write to an SVG attribute or style invalidates the element, even to the same value, and the figure sets a few hundred per frame.
type Memo = Record<string, string | number>;
const last = new WeakMap<Element, Memo>();
const memo = (e: Element): Memo => {
  let m = last.get(e);
  if (!m) last.set(e, (m = {}));
  return m;
};

/** Rounds to a hundredth. */
export const r2 = (v: number) => Math.round(v * 100) / 100;

export function attr(e: Element | undefined, name: string, v: string) {
  if (!e) return;
  const m = memo(e);
  if (m[name] !== v) {
    m[name] = v;
    e.setAttribute(name, v);
  }
}

/** An inline style number (0–1 for the opacities), rounded to a hundredth. */
export function sty(e: SVGElement | HTMLElement | undefined, prop: 'opacity' | 'fillOpacity' | 'strokeDashoffset', v: number) {
  if (!e) return;
  const q = Math.round(v * 100);
  const m = memo(e);
  if (m[prop] !== q) {
    m[prop] = q;
    e.style[prop] = String(q / 100);
  }
}
