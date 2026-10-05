// Types for the vendored hairline kernel (kernel.js): only what the site's host calls.
declare const HL: {
  inject(root: Document | ShadowRoot): void;
  mk(tag: string, attrs: Record<string, string>, parent: Element): SVGElement;
  setReducedMotion(on: boolean): void;
};
export default HL;
