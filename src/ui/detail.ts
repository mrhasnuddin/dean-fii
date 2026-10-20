// Detail panel for a project, an event or About: a native <dialog> (focus trap, Esc, inert page for
// free). Slides in over the text column so the wallet stays visible; bottom sheet on phones.
import './detail.css';
import { countries, events, profile, projects, toolLogo, toolNames, type ToolId } from '../content/portfolio';
import { motion } from '../motion';
import { mountFlow, type Flow } from './flowFigure';
import { ARROW, bindSteps, watchWraps } from './stepChips';
import { mountWorkflowSection, workflowBody } from './workflowSection';

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

/** A project with a recorded walkthrough (public/media/motion/<id>.mp4 + -poster.webp) shows it in place of the thumbnails. */
function walkthrough(src: string, alt: string) {
  return `<div class="dt-media dt-motion">
    <video class="dt-main" src="${src}.mp4" poster="${src}-poster.webp" muted loop playsinline preload="metadata" aria-label="${esc(alt)}, a walkthrough of the landing page"></video>
    <button type="button" class="dt-pp" aria-label="Pause the walkthrough">Pause</button></div>`;
}

function gallery(images: string[], alt: string, motionSrc?: string) {
  if (motionSrc) return walkthrough(motionSrc, alt);
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
  // The live figure of the panel showing, if any (and its step chips): torn down when the panel changes or closes.
  let stopLive = () => {};
  let liveToken = 0;
  function stopFlow() {
    liveToken++;
    stopLive();
    stopLive = () => {};
  }
  function startFlow(t: DetailTarget) {
    stopFlow();
    if (t.kind === 'about') {
      const section = dlg.querySelector<HTMLElement>('.dt-wf');
      if (section) stopLive = mountWorkflowSection(section);
      return;
    }
    if (t.kind !== 'project') return;
    const stage = dlg.querySelector<HTMLElement>('.dt-fig-stage');
    const readEl = dlg.querySelector<HTMLElement>('.dt-fig-read');
    const p = projects.find((x) => x.id === t.id);
    if (!stage || !readEl || !p) return;
    const list = dlg.querySelector<HTMLElement>('.dt-steps');
    const stopWraps = list ? watchWraps(list) : () => {};
    const token = liveToken;
    let mark = (_a: number) => {};
    let teardown = () => stopWraps();
    stopLive = () => teardown();
    mountFlow(stage, readEl, p.flow, 'chain', { auto: true, onPick: (a) => mark(a) })
      .then((h) => {
        if (token !== liveToken) return h.destroy();
        const chips = list ? bindSteps(list, h) : null;
        if (chips) mark = chips.mark;
        teardown = () => {
          stopWraps();
          chips?.dispose();
          h.destroy();
        };
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
      body = `${gallery(p.images, p.title, p.motion)}
        <p class="dt-desc">${esc(p.description)}</p>
        ${flowSection(p.flow)}
        <h3 class="dt-h3">Tools used</h3><ul class="dt-tools">${p.tools.map(tool).join('')}</ul>
        <h3 class="dt-h3">Tech stack</h3><ul class="dt-tools">${p.stack.map((t) => `<li class="dt-tool dt-stack">${esc(t)}</li>`).join('')}</ul>`;
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
        <section class="dt-flow dt-wf" aria-labelledby="dt-wf-title"><h3 class="dt-h3" id="dt-wf-title">How I work</h3>${workflowBody()}</section>
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
  // The walkthrough plays unless motion is reduced (the poster shows then); the button always works.
  function startMotion() {
    const v = dlg.querySelector<HTMLVideoElement>('video.dt-main');
    const b = dlg.querySelector<HTMLButtonElement>('.dt-pp');
    if (!v || !b) return;
    const sync = () => {
      b.textContent = v.paused ? 'Play' : 'Pause';
      b.setAttribute('aria-label', `${v.paused ? 'Play' : 'Pause'} the walkthrough`);
    };
    v.addEventListener('play', sync);
    v.addEventListener('pause', sync);
    b.addEventListener('click', () => (v.paused ? void v.play() : v.pause()));
    if (!motion.reduced()) v.play().catch(() => {});
    sync();
  }
  dlg.addEventListener('close', () => {
    dlg.querySelector('video')?.pause();
    stopFlow();
    current = null;
    closeCb();
  });

  return {
    open(t) {
      current = t;
      stopFlow();
      render(t);
      startMotion();
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
