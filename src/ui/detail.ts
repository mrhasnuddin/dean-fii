// Detail panel for a project, an event or About: a native <dialog> (focus trap, Esc, inert page for
// free). Slides in over the text column so the wallet stays visible; bottom sheet on phones.
import './detail.css';
import { countries, events, profile, projects, toolLogo, toolNames, type ToolId } from '../content/portfolio';
import { mountFlow, type Flow, type FlowHandle } from './flowFigure';

export type DetailTarget = { kind: 'project'; id: string } | { kind: 'event'; id: string } | { kind: 'about' };

export interface Detail {
  open(target: DetailTarget): void;
  close(): void;
  isOpen(): boolean;
  onClose(cb: () => void): void;
  onNavigate(cb: (target: DetailTarget) => void): void;
  onInvite(cb: () => void): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const tool = (t: string) =>
  `<li class="dt-tool"><img src="${toolLogo(t)}" alt="" width="20" height="20"><span>${toolNames[t as ToolId] ?? t}</span></li>`;

// The arrow into a stage: straight on along a row; at the start of a wrapped row, down from the row above
// and on (markWraps picks which). Both are the same size, so swapping them never moves the layout.
const ARROW = `<svg class="dt-arrow" viewBox="0 0 14 14" aria-hidden="true"><path class="dt-a-on" d="M2 7h9M8 4l3 3-3 3"/><path class="dt-a-turn" d="M3 1.5v3.5a2.5 2.5 0 0 0 2.5 2.5H11M8 4.5l3 3-3 3"/></svg>`;

/** Design flow: the chain figure (blocks = stages, drawn by flowFigure.ts), the stages in order, and how it went. */
function flowSection(flow: Flow) {
  const n = flow.steps.length;
  // Each stage after the first carries the arrow into it, so a wrapped row starts with its own arrow.
  const steps = flow.steps
    .map((s, i) => `<li class="dt-step${i === n - 1 ? ' is-on' : ''}" data-i="${i}">${i ? ARROW : ''}<button type="button" class="dt-chip">${esc(s)}</button></li>`)
    .join('');
  return `<section class="dt-flow" aria-labelledby="dt-flow-title">
    <h3 class="dt-h3" id="dt-flow-title">Design flow</h3>
    <figure class="dt-fig">
      <div class="dt-fig-stage" role="img" aria-label="The design flow as a chain of blocks, one block per stage: ${esc(flow.steps.join(', '))}."></div>
      <figcaption class="dt-fig-read" aria-hidden="true"></figcaption>
    </figure>
    <ol class="dt-steps" aria-label="Stages, in order">${steps}</ol>
    <p class="dt-desc">${esc(flow.text)}</p>
  </section>`;
}

function gallery(images: string[], alt: string) {
  return `<div class="dt-media">
    <img class="dt-main" src="${images[0]}" alt="${esc(alt)}, image 1 of ${images.length}" decoding="async">
    <div class="dt-thumbs" role="group" aria-label="Images">${images
      .map((src, i) => `<button type="button" class="dt-thumb" aria-pressed="${i === 0}" data-src="${src}" data-alt="${esc(alt)}, image ${i + 1} of ${images.length}"><img src="${src}" alt="" decoding="async"><span class="dt-sr">Show image ${i + 1}</span></button>`)
      .join('')}</div></div>`;
}

export function createDetail(): Detail {
  const dlg = document.createElement('dialog');
  dlg.className = 'detail';
  dlg.setAttribute('aria-labelledby', 'detail-title');
  // Lenis smooth scroll takes every wheel event on the page; the panel scrolls natively instead.
  dlg.setAttribute('data-lenis-prevent', '');
  document.body.append(dlg);
  let current: DetailTarget | null = null;
  let closeCb = () => {};
  let navCb: (t: DetailTarget) => void = () => {};
  let inviteCb = () => {};
  // The live figure of the panel showing, if any: torn down when the panel changes or closes.
  let flowHandle: FlowHandle | null = null;
  let flowToken = 0;
  let wrapWatch: ResizeObserver | null = null;
  let letGo = 0; // a tap on a stage holds it a while, then lets the chain play again
  function stopFlow() {
    flowToken++;
    flowHandle?.destroy();
    flowHandle = null;
    wrapWatch?.disconnect();
    wrapWatch = null;
    clearTimeout(letGo);
  }
  /** Marks each stage that starts a new row, so its arrow turns down from the row above. */
  function markWraps(list: HTMLElement) {
    const items = [...list.children] as HTMLElement[];
    items.forEach((li, i) => li.classList.toggle('is-wrap', i > 0 && li.offsetTop > items[i - 1].offsetTop + 4));
  }
  /** The stages list follows the figure (its pointer, its play) and drives it: hover, focus or tap a stage to show it. */
  function bindSteps(list: HTMLElement, handle: FlowHandle) {
    const items = [...list.querySelectorAll<HTMLElement>('.dt-step')];
    const at = (e: Event) => Number((e.target as Element).closest<HTMLElement>('.dt-step')?.dataset.i ?? -1);
    list.addEventListener('pointerover', (e) => {
      const i = at(e);
      if (e.pointerType === 'mouse' && i >= 0 && (e.target as Element).closest('.dt-chip')) handle.hold(i);
    });
    list.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && handle.hold(-1));
    list.addEventListener('focusin', (e) => handle.hold(at(e)));
    list.addEventListener('focusout', (e) => !list.contains(e.relatedTarget as Node) && handle.hold(-1));
    list.addEventListener('click', (e) => {
      const i = at(e);
      if (i < 0 || (e as PointerEvent).pointerType === 'mouse') return;
      handle.hold(i);
      clearTimeout(letGo);
      if ((e as PointerEvent).pointerType) letGo = window.setTimeout(() => handle.hold(-1), 3200); // a tap, not a key
    });
    return (a: number) => items.forEach((li, i) => li.classList.toggle('is-on', i === (a < 0 ? items.length - 1 : a)));
  }
  function startFlow(t: DetailTarget) {
    stopFlow();
    if (t.kind !== 'project') return;
    const stage = dlg.querySelector<HTMLElement>('.dt-fig-stage');
    const readEl = dlg.querySelector<HTMLElement>('.dt-fig-read');
    const p = projects.find((x) => x.id === t.id);
    if (!stage || !readEl || !p) return;
    const list = dlg.querySelector<HTMLElement>('.dt-steps');
    if (list) {
      wrapWatch = new ResizeObserver(() => markWraps(list));
      wrapWatch.observe(list);
    }
    const token = flowToken;
    let mark = (_a: number) => {};
    mountFlow(stage, readEl, p.flow, 'chain', { auto: true, onPick: (a) => mark(a) })
      .then((h) => {
        if (token !== flowToken) return h.destroy();
        flowHandle = h;
        if (list) mark = bindSteps(list, h);
      })
      .catch(() => stage.closest('.dt-fig')?.remove()); // no figure: the stages and the text still say it
  }

  function render(t: DetailTarget) {
    let head = '';
    let body = '';
    let actions = '';
    let pager = '';
    if (t.kind === 'project') {
      const i = projects.findIndex((p) => p.id === t.id);
      const p = projects[i];
      head = `<p class="dt-eyebrow">${esc(p.category)} · Project ${String(i + 1).padStart(2, '0')}/${projects.length}</p>
        <h2 id="detail-title">${esc(p.title)}</h2><p class="dt-roles">${p.roles.map(esc).join(' · ')}</p>`;
      body = `${gallery(p.images, p.title)}
        <p class="dt-desc">${esc(p.description)}</p>
        ${flowSection(p.flow)}
        <h3 class="dt-h3">Tools used</h3><ul class="dt-tools">${p.tools.map(tool).join('')}</ul>`;
      actions = `<a class="dt-cta" href="${p.link}" target="_blank" rel="noopener noreferrer">Visit site <span aria-hidden="true">↗</span><span class="dt-sr"> (opens in a new tab)</span></a>`;
      pager = pagerHtml(i, projects.length, 'project');
    } else if (t.kind === 'event') {
      const i = events.findIndex((e) => e.id === t.id);
      const e = events[i];
      head = `<p class="dt-eyebrow">${esc(e.place)} · <strong>${esc(countries[e.country])}</strong></p>
        <h2 id="detail-title">${esc(e.title)}</h2><p class="dt-roles">${esc(e.role)}</p>`;
      body = `${gallery(e.images, e.title)}<p class="dt-desc">${esc(e.description)}</p>`;
      actions = `<button type="button" class="dt-cta" data-invite>Invite Dean</button>`;
      pager = pagerHtml(i, events.length, 'event');
    } else {
      head = `<p class="dt-eyebrow">About</p><h2 id="detail-title">${profile.name}</h2><p class="dt-roles">${profile.roles.join(' · ')}</p>`;
      body = `<div class="dt-media"><img class="dt-main dt-portrait" src="${profile.portrait.color}" alt="Dean speaking on stage with a microphone"></div>
        ${profile.bio.map((b) => `<p class="dt-desc">${esc(b)}</p>`).join('')}
        ${profile.toolGroups.map((g) => `<h3 class="dt-h3">${esc(g.title)}</h3><ul class="dt-tools">${g.tools.map(tool).join('')}</ul>`).join('')}
        <h3 class="dt-h3">Languages</h3><ul class="dt-tools">${profile.languages
          .map((l) => `<li class="dt-tool"><img src="${l.flag}" alt="" width="20" height="14"><span>${l.name}</span></li>`)
          .join('')}</ul>`;
      actions = `<button type="button" class="dt-cta" data-invite>Get in touch</button>`;
    }
    dlg.innerHTML = `<div class="dt-panel">
      <header class="dt-head"><button type="button" class="dt-close" aria-label="Close">‹ Back</button>${actions}</header>
      <div class="dt-scroll">${head}${body}${pager}</div></div>`;
  }

  function pagerHtml(i: number, n: number, kind: 'project' | 'event') {
    const list = kind === 'project' ? projects : events;
    const prev = list[(i - 1 + n) % n];
    const next = list[(i + 1) % n];
    // A short direction label, the title as a one-line sub-label (hidden on phones; the label keeps the full title).
    return `<nav class="dt-pager" aria-label="More">
      <button type="button" data-go="${prev.id}" data-kind="${kind}" aria-label="Previous: ${esc(prev.title)}"><span class="dt-dir"><span aria-hidden="true">‹</span> Previous</span><span class="dt-name">${esc(prev.title)}</span></button>
      <span>${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</span>
      <button type="button" data-go="${next.id}" data-kind="${kind}" aria-label="Next: ${esc(next.title)}"><span class="dt-dir">Next <span aria-hidden="true">›</span></span><span class="dt-name">${esc(next.title)}</span></button></nav>`;
  }

  dlg.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === dlg) return dlg.close(); // backdrop
    if (el.closest('.dt-close')) return dlg.close();
    if (el.closest('[data-invite]')) {
      dlg.close();
      return inviteCb();
    }
    const thumb = el.closest<HTMLButtonElement>('.dt-thumb');
    if (thumb) {
      const main = dlg.querySelector<HTMLImageElement>('.dt-main')!;
      main.src = thumb.dataset.src!;
      main.alt = thumb.dataset.alt!;
      dlg.querySelectorAll('.dt-thumb').forEach((b) => b.setAttribute('aria-pressed', String(b === thumb)));
      return;
    }
    const go = el.closest<HTMLButtonElement>('[data-go]');
    if (go) navCb({ kind: go.dataset.kind as 'project' | 'event', id: go.dataset.go! });
  });
  dlg.addEventListener('close', () => {
    stopFlow();
    current = null;
    closeCb();
  });

  return {
    open(t) {
      current = t;
      stopFlow();
      render(t);
      startFlow(t);
      if (!dlg.open) dlg.showModal();
      dlg.querySelector<HTMLElement>('.dt-scroll')?.scrollTo(0, 0);
      dlg.querySelector<HTMLElement>('.dt-close')?.focus();
    },
    close: () => dlg.open && dlg.close(),
    isOpen: () => current !== null,
    onClose: (cb) => (closeCb = cb),
    onNavigate: (cb) => (navCb = cb),
    onInvite: (cb) => (inviteCb = cb),
  };
}
