// Design flow figures (docs/device-design.md §29): the "chain" Hairline figure (src/figures/chain.js,
// made with the hairline-create skill and checked with its look) drawn in a project's detail panel.
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
    host: { stage: HTMLElement; svg: SVGElement; read: { textContent: string }; flow: ChainFlow },
    value: number,
  ): { set(v: number): void; destroy(): void };
}
type ChainFlow = { steps: [string, number][]; end: 'handover' | 'maintenance' | null };

let ready: Promise<{ HL: typeof import('../vendor/hairline/kernel.js').default; chain: FigureDef }> | null = null;
function load() {
  ready ??= (async () => {
    const HL = (await import('../vendor/hairline/kernel.js')).default;
    let chain: FigureDef | null = null;
    // A figure file uses the kernel as the global HL and declares itself through hairline({ … }).
    Object.assign(globalThis, { HL, hairline: (def: FigureDef) => (chain = def) });
    await import('../figures/chain.js');
    if (!chain) throw new Error('hairline: the chain figure did not declare itself');
    HL.inject(document);
    HL.setReducedMotion(motion.reduced());
    motion.subscribe((r) => HL.setReducedMotion(r));
    return { HL, chain };
  })();
  return ready;
}

/** The project's steps as the figure's blocks: MVPs and iterations are two plates, a v1 to v3 build three. */
function toChain(flow: Flow): ChainFlow {
  const steps = flow.steps.map((s): [string, number] => [s, /v1 to v3/i.test(s) ? 3 : /mvp|iteration/i.test(s) ? 2 : 1]);
  const last = flow.steps[flow.steps.length - 1] ?? '';
  return { steps, end: /handover/i.test(last) ? 'handover' : /maintenance/i.test(last) ? 'maintenance' : null };
}

/** Draws the flow into `stage` and its read-out into `readEl`; resolves with the tear-down. */
export async function mountFlow(stage: HTMLElement, readEl: HTMLElement, flow: Flow): Promise<() => void> {
  const { HL, chain } = await load();
  if (!stage.isConnected) return () => {}; // the panel moved on while the figure loaded
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
  const handle = chain.mount({ stage, svg, read, flow: toChain(flow) }, chain.range[1]);
  return () => {
    handle.destroy();
    stage.replaceChildren();
  };
}
