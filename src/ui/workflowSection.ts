// About › How I work (docs/device-design.md §32): the steps as an accordion beside the instrument (src/figures/run).
// The step open is the step the instrument is playing: while nobody has chosen one, the tour opens them in turn; a step
// chosen here (click, tap, Enter) plays on the instrument and stays open until the pointer or the focus leaves, then
// the tour comes back. Framework opens onto its four sub-steps, each played on its own. Used by the About panel
// (detail.ts) and the List view (listView.ts); styles in detail.css (.wf-*).
import { profile, type WorkflowCopy } from '../content/portfolio';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pad = (n: number) => String(n).padStart(2, '0');
const wf: WorkflowCopy = profile.workflow;
const FW = wf.steps.findIndex((s) => s.subs); // the step with sub-steps
let instances = 0;

/** The accordion (with the intro and the closing line) and, beside it, the figure's slot. `level` is the steps' heading level. */
export function workflowBody(level = 4) {
  const u = ++instances; // ids are per instance: the About panel and the List view can both be in the page
  const id = (k: string, i: number) => `wf${u}-${k}${i}`;
  const item = (s: WorkflowCopy['steps'][number], i: number) => {
    const subs = s.subs
      ? `<ol class="wf-subs">${s.subs
          .map(
            (x, j) => `<li class="wf-sub${j === 0 ? ' is-on' : ''}" data-s="${j}"><i class="wf-bar" aria-hidden="true"></i><button type="button" class="wf-sh" id="${id('sh', j)}" aria-expanded="${j === 0}" aria-controls="${id('sp', j)}"><span class="wf-sn" aria-hidden="true">${i + 1}.${j + 1}</span>${esc(x.title)}</button>
              <div class="wf-sp" id="${id('sp', j)}" role="region" aria-labelledby="${id('sh', j)}"><div class="wf-sp-in"><p>${esc(x.text)}</p></div></div></li>`,
          )
          .join('')}</ol>`
      : '';
    return `<div class="wf-item${i === 0 ? ' is-on' : ''}" data-i="${i}"><i class="wf-bar" aria-hidden="true"></i>
      <h${level} class="wf-h"><button type="button" class="wf-hd" id="${id('h', i)}" aria-expanded="${i === 0}" aria-controls="${id('p', i)}"><span class="wf-n" aria-hidden="true">${pad(i + 1)}</span><span class="wf-t">${esc(s.title)}</span><span class="wf-ind" aria-hidden="true"></span></button></h${level}>
      <div class="wf-pn" id="${id('p', i)}" role="region" aria-labelledby="${id('h', i)}"><div class="wf-pn-in"><p class="wf-tx">${esc(s.text)}</p>${subs}</div></div></div>`;
  };
  return `<div class="wf-layout">
    <div class="wf-side">
      <p class="wf-intro">${esc(wf.intro)}</p>
      <div class="wf-acc">${wf.steps.map(item).join('')}</div>
      <p class="wf-close">“${esc(wf.closing)}”</p>
    </div>
    <div class="wf-fig" role="img" aria-label="An instrument that plays the step that is open."></div>
  </div>`;
}

const LET_GO = 14000; // ms a tapped step is held before the tour comes back (a tap has no pointer to leave)

/** Draws the figure (its own lazy chunk) into a section made with workflowBody() and keeps the two in step. */
export function mountWorkflowSection(section: HTMLElement): () => void {
  const host = section.querySelector<HTMLElement>('.wf-fig');
  const acc = section.querySelector<HTMLElement>('.wf-acc');
  if (!host || !acc) return () => {};
  const items = [...acc.querySelectorAll<HTMLElement>('.wf-item')];
  const subs = [...acc.querySelectorAll<HTMLElement>('.wf-sub')];
  let step = 0, sub = 0; // what is open
  let gone = false;
  let handle: { hold(step: number, sub?: number): void; destroy(): void } | null = null;
  let letGo = 0;
  const off = new AbortController();
  const on = { signal: off.signal };

  /** Opens a step (and Framework's sub-step). The panels animate; nothing else moves. */
  function show(s: number, u: number) {
    step = s;
    sub = u;
    items.forEach((el, i) => {
      const open = i === s;
      el.classList.toggle('is-on', open);
      el.querySelector('.wf-hd')?.setAttribute('aria-expanded', String(open));
    });
    subs.forEach((el, j) => {
      const open = s === FW && j === u;
      el.classList.toggle('is-on', open);
      el.querySelector('.wf-sh')?.setAttribute('aria-expanded', String(open));
    });
  }
  /** The tour's timer: the open step (and Framework's sub-step) fills a line as its time runs out. The bar's own transform is set (not a variable on its parent), and only when it has moved. */
  const bars = new Map<HTMLElement, HTMLElement>([...items, ...subs].map((el) => [el, el.querySelector<HTMLElement>(':scope > .wf-bar')!]));
  const filled = new Map<HTMLElement, number>();
  let timing: HTMLElement[] = [];
  function timer(p: number, sp: number) {
    const pairs: [HTMLElement | undefined, number][] = [[items[step], p], [subs[sub], sp]];
    const now = pairs.filter(([el, v]) => el && v >= 0).map(([el]) => el!);
    for (const el of timing) if (!now.includes(el)) el.classList.remove('is-timing');
    for (const [el, v] of pairs) {
      if (!el || v < 0) continue;
      el.classList.add('is-timing');
      const bar = bars.get(el)!;
      if (Math.abs((filled.get(bar) ?? -1) - v) > 0.012) { // about every 60 ms: a line that fills over 5 s does not need more
        filled.set(bar, v);
        bar.style.transform = `scaleY(${v.toFixed(3)})`;
      }
    }
    timing = now;
  }

  // ---- the accordion drives the figure
  const release = () => {
    clearTimeout(letGo);
    handle?.hold(-1);
  };
  function pick(s: number, u: number, how: string) {
    show(s, u);
    handle?.hold(s, u);
    clearTimeout(letGo);
    if (how === 'touch' || how === 'pen') letGo = window.setTimeout(release, LET_GO);
  }
  acc.addEventListener('click', (e) => {
    const how = (e as PointerEvent).pointerType || 'key';
    const target = e.target as Element;
    const sh = target.closest<HTMLElement>('.wf-sh');
    if (sh) return pick(FW, Number(sh.closest<HTMLElement>('.wf-sub')!.dataset.s), how);
    const hd = target.closest<HTMLElement>('.wf-hd');
    if (!hd) return;
    const i = Number(hd.closest<HTMLElement>('.wf-item')!.dataset.i);
    pick(i, i === FW && step === FW ? sub : 0, how);
  }, on);
  section.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && release(), on);
  section.addEventListener('focusout', (e) => !section.contains(e.relatedTarget as Node) && release(), on);
  // Up and Down move between the step headings (Enter or Space opens one)
  acc.addEventListener('keydown', (e) => {
    const heads = [...acc.querySelectorAll<HTMLButtonElement>('.wf-hd')];
    const at = heads.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? heads.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    heads[(to + heads.length) % heads.length].focus();
  }, on);

  // ---- the space the tallest step needs is kept, so the page below never moves as steps open and close
  const reserve = () => {
    acc.style.minHeight = '';
    let heads = 0, tallest = 0;
    for (const el of items) {
      heads += el.querySelector<HTMLElement>('.wf-h')!.offsetHeight;
      // a closed panel's content still reports its full height; Framework's counts with its longest sub-step text open
      const open = [...el.querySelectorAll<HTMLElement>('.wf-sp')].reduce((a, p) => a + p.offsetHeight, 0);
      const most = Math.max(0, ...[...el.querySelectorAll<HTMLElement>('.wf-sp-in')].map((p) => p.scrollHeight));
      tallest = Math.max(tallest, el.querySelector<HTMLElement>('.wf-pn-in')!.scrollHeight - open + most);
    }
    acc.style.minHeight = `${Math.ceil(heads + tallest + items.length + 1)}px`;
  };
  let width = 0;
  const ro = new ResizeObserver(() => {
    if (acc.offsetWidth !== width) (width = acc.offsetWidth), reserve(); // only a change of width: the minimum itself changes the height
  });
  ro.observe(acc);
  document.fonts?.ready.then(() => !gone && reserve());

  import('../figures/run/live')
    .then(({ mountRun }) => {
      if (gone) return;
      handle = mountRun(host, { onStep: show, onTimer: timer });
    })
    .catch(() => host.remove()); // no figure: the steps and their text still say it

  return () => {
    gone = true;
    clearTimeout(letGo);
    off.abort();
    ro.disconnect();
    handle?.destroy();
  };
}
