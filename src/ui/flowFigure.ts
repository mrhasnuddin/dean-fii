// Design flow figures (docs/device-design.md §29, §30): Hairline figures made with the hairline-create
// skill and checked with its look. The panels draw "chain" (src/figures/chain.js).
// This is the host a figure expects, as the skill's bench page is: a stage element marked
// data-hairline, a 400 × 320 svg in it, and a read-out. The kernel and the figure load on the first
// panel that needs them, and each figure is torn down when its panel closes or changes.
import { motion } from '../motion';

export interface Flow {
  steps: string[];
  text: string;
}
interface FigureDef {
  name: string;
  means: string;
  range: [number, number, number];
  mount(
    host: {
      stage: HTMLElement;
      svg: SVGElement;
      read: { textContent: string };
      flow: ChainFlow;
      auto?: boolean;
      onPick?: (i: number) => void;
    },
    value: number,
  ): { set(v: number): void; hold?(i: number): void; destroy(): void };
}
type ChainFlow = { steps: [string, number][]; end: 'handover' | 'maintenance' | null };

export type FigureName = 'chain';
const FILES: Record<FigureName, () => Promise<unknown>> = {
  chain: () => import('../figures/chain.js'),
};
const defs = new Map<string, FigureDef>();
let kernel: Promise<typeof import('../vendor/hairline/kernel.js').default> | null = null;
function loadKernel() {
  kernel ??= (async () => {
    const HL = (await import('../vendor/hairline/kernel.js')).default;
    // A figure file uses the kernel as the global HL and declares itself through hairline({ … }).
    Object.assign(globalThis, { HL, hairline: (def: FigureDef) => defs.set(def.name, def) });
    HL.inject(document);
    HL.setReducedMotion(motion.reduced());
    motion.subscribe((r) => HL.setReducedMotion(r));
    return HL;
  })();
  return kernel;
}
async function load(name: FigureName) {
  const HL = await loadKernel();
  if (!defs.has(name)) await FILES[name]();
  const def = defs.get(name);
  if (!def) throw new Error(`hairline: the ${name} figure did not declare itself`);
  return { HL, def };
}

/** The project's steps as the figure's blocks: MVPs and iterations are two plates, a v1 to v3 build three. */
function toChain(flow: Flow): ChainFlow {
  const steps = flow.steps.map((s): [string, number] => [s, /v1 to v3/i.test(s) ? 3 : /mvp|iteration/i.test(s) ? 2 : 1]);
  const last = flow.steps[flow.steps.length - 1] ?? '';
  return { steps, end: /handover/i.test(last) ? 'handover' : /maintenance/i.test(last) ? 'maintenance' : null };
}

export interface FlowOptions {
  /** The figure plays itself while nobody touches it (the chain does; the others ignore it). */
  auto?: boolean;
  /** Hears every stage the figure picks, by the pointer, its play or hold(); -1 is rest. */
  onPick?: (i: number) => void;
}
export interface FlowHandle {
  /** Picks stage i from outside the figure, as the pointer would (-1 lets go). */
  hold(i: number): void;
  destroy(): void;
}

/** Draws the flow into `stage` and its read-out into `readEl`; resolves with a handle to pick from outside and tear down. */
export async function mountFlow(
  stage: HTMLElement,
  readEl: HTMLElement,
  flow: Flow,
  figure: FigureName = 'chain',
  opts: FlowOptions = {},
): Promise<FlowHandle> {
  const { HL, def: chain } = await load(figure);
  if (!stage.isConnected) return { hold() {}, destroy() {} }; // the panel moved on while the figure loaded
  stage.setAttribute('data-hairline', chain.name);
  stage.setAttribute('data-hairline-theme', 'dark');
  const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, stage);
  const n = flow.steps.length;
  // "rest" (the figure's word for nothing under the pointer) becomes a hint; the stage names are the figure's.
  const read = {
    set textContent(v: string) {
      readEl.textContent = v === 'rest' ? `${n} stages` : v;
    },
    get textContent() {
      return readEl.textContent ?? '';
    },
  };
  const handle = chain.mount({ stage, svg, read, flow: toChain(flow), auto: opts.auto, onPick: opts.onPick }, chain.range[1]);
  return {
    hold: (i) => handle.hold?.(i),
    destroy: () => {
      handle.destroy();
      stage.replaceChildren();
    },
  };
}
