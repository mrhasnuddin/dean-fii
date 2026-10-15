// Step chips joined by arrows (docs/device-design.md §30): the design-flow stages in a project panel and the
// workflow steps (About, List view). The list follows its figure and drives it: hover, focus or tap a step.

// The arrow into a stage: straight on along a row; at the start of a wrapped row, down from the row above
// and on (watchWraps picks which). Both are the same size, so swapping them never moves the layout.
export const ARROW = `<svg class="dt-arrow" viewBox="0 0 14 14" aria-hidden="true"><path class="dt-a-on" d="M2 7h9M8 4l3 3-3 3"/><path class="dt-a-turn" d="M3 1.5v3.5a2.5 2.5 0 0 0 2.5 2.5H11M8 4.5l3 3-3 3"/></svg>`;

/** Marks each stage that starts a new row, so its arrow turns down from the row above; returns the tear-down. */
export function watchWraps(list: HTMLElement): () => void {
  const mark = () => {
    const items = [...list.children] as HTMLElement[];
    items.forEach((li, i) => li.classList.toggle('is-wrap', i > 0 && li.offsetTop > items[i - 1].offsetTop + 4));
  };
  const ro = new ResizeObserver(mark);
  ro.observe(list);
  return () => ro.disconnect();
}

/**
 * Binds the chips to a figure's hold(i) (-1 lets go). Returns `mark(a)`, which lights the chip of stage a
 * (a < 0: the last one when `restLast`, else none), and the tear-down.
 */
export function bindSteps(list: HTMLElement, handle: { hold(i: number): void }, restLast = true) {
  const items = [...list.querySelectorAll<HTMLElement>('.dt-step')];
  const at = (e: Event) => Number((e.target as Element).closest<HTMLElement>('.dt-step')?.dataset.i ?? -1);
  const off = new AbortController();
  const on = { signal: off.signal };
  let letGo = 0; // a tap holds a stage a while, then lets the figure play again
  list.addEventListener('pointerover', (e) => {
    const i = at(e);
    if (e.pointerType === 'mouse' && i >= 0 && (e.target as Element).closest('.dt-chip')) handle.hold(i);
  }, on);
  list.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && handle.hold(-1), on);
  list.addEventListener('focusin', (e) => handle.hold(at(e)), on);
  list.addEventListener('focusout', (e) => !list.contains(e.relatedTarget as Node) && handle.hold(-1), on);
  list.addEventListener('click', (e) => {
    const i = at(e);
    if (i < 0 || (e as PointerEvent).pointerType === 'mouse') return;
    handle.hold(i);
    clearTimeout(letGo);
    if ((e as PointerEvent).pointerType) letGo = window.setTimeout(() => handle.hold(-1), 3200); // a tap, not a key
  }, on);
  return {
    mark: (a: number) => items.forEach((li, i) => li.classList.toggle('is-on', i === (a < 0 && restLast ? items.length - 1 : a))),
    dispose: () => {
      off.abort();
      clearTimeout(letGo);
    },
  };
}
