// Detail page for a project, an event or About: a native <dialog> (focus trap, Esc, inert page for free) that opens
// full screen, to be read. The device behind it rests (main.ts pauses the 3D scene; site.css `html.detail-open`).
import './detail.css';
import { FLAG_SVG } from '../brand/logo';
import { archiveWorks, countries, events, isApp, isArchive, profile, selectedWorks, works } from '../content/portfolio';
import { motion } from '../motion';
import { aboutSections, bindRail, esc, eventSections, hasRail, pageHtml, projectSections, type Sec } from './detailSections';
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

/** Design flow: the chain figure (blocks = stages, drawn by flowFigure.ts) and the stages in order. The story says why; this only shows the shape. */
function flowSection(flow: Flow) {
  const n = flow.steps.length;
  // Each stage after the first carries the arrow into it, so a wrapped row starts with its own arrow.
  const steps = flow.steps
    .map((s, i) => `<li class="dt-step${i === n - 1 ? ' is-on' : ''}" data-i="${i}">${i ? ARROW : ''}<button type="button" class="dt-chip">${esc(s)}</button></li>`)
    .join('');
  return `<div class="dt-flow">
    <figure class="dt-fig">
      <div class="dt-fig-stage" role="img" aria-label="The design flow as a chain of blocks, one block per stage: ${esc(flow.steps.join(', '))}."></div>
      <figcaption class="dt-fig-read" aria-hidden="true"></figcaption>
    </figure>
    <ol class="dt-steps" aria-label="Stages, in order">${steps}</ol>
  </div>`;
}

/** A project with a recorded walkthrough (public/media/motion/<id>.mp4 + -poster.webp) shows it in place of the thumbnails. */
function walkthrough(src: string, alt: string) {
  return `<div class="dt-media dt-motion">
    <video class="dt-main" data-src="${src}" poster="${src}-poster.webp" muted loop playsinline preload="none" aria-label="${esc(alt)}, a walkthrough of the landing page"></video>
    <button type="button" class="dt-pp" aria-label="Pause the walkthrough">Pause</button></div>`;
}

const CHEVRON = { prev: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7' };

/** Pictures: a carousel, one 16:10 picture at a time, swiped or stepped with the arrows; the dots and the count sit at the foot of the frame. */
function gallery(images: string[], alt: string, motionSrc?: string) {
  if (motionSrc) return walkthrough(motionSrc, alt);
  const n = images.length;
  const slides = images
    .map((src, i) => `<figure class="dt-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}"><img src="${src}" alt="${esc(alt)}, image ${i + 1} of ${n}" decoding="async"${i ? ' loading="lazy"' : ''}></figure>`)
    .join('');
  if (n < 2) return `<div class="dt-carousel"><div class="dt-track">${slides}</div></div>`;
  const nav = (dir: 'prev' | 'next') =>
    `<button type="button" class="dt-nav" data-dir="${dir}" aria-label="${dir === 'prev' ? 'Previous' : 'Next'} image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CHEVRON[dir]}"/></svg></button>`;
  const dots = images.map((_, i) => `<button type="button" class="dt-dot" data-i="${i}" aria-label="Show image ${i + 1}" aria-current="${i === 0}"></button>`).join('');
  return `<section class="dt-carousel" role="region" aria-roledescription="carousel" aria-label="${esc(alt)}, ${n} images">
    <div class="dt-track" tabindex="0" aria-label="Images: use the left and right arrow keys">${slides}</div>
    ${nav('prev')}${nav('next')}
    <div class="dt-pages"><span class="dt-dots">${dots}</span><span class="dt-count" aria-hidden="true">1 / ${n}</span></div>
    <p class="dt-sr" role="status">Image 1 of ${n}</p></section>`;
}

/** An event's pictures: one strip as wide as the text, at the pictures' own shapes (nothing cropped), drifting slowly with its
    ends faded out. The set is shown twice so the loop has no seam; the repeats and the second set are hidden from a screen reader. */
function marquee(images: string[], alt: string) {
  const n = images.length;
  const reps = Math.ceil(6 / n); // one set is at least six pictures wide, so it is wider than the column
  const items = (clone: boolean) =>
    Array.from({ length: n * reps }, (_, i) => {
      const real = !clone && i < n;
      return `<figure class="dt-mq-item"${real ? '' : ' aria-hidden="true"'}><img src="${images[i % n]}" alt="${real ? `${esc(alt)}, image ${i + 1} of ${n}` : ''}" decoding="async"></figure>`;
    }).join('');
  return `<section class="dt-marquee" aria-label="${esc(alt)}, ${n} pictures">
    <div class="dt-mq-view"><div class="dt-mq-track">${items(false)}${items(true)}</div></div>
    <button type="button" class="dt-pp dt-mq-pp" aria-label="Pause the pictures">Pause</button></section>`;
}

/** Sets the marquee's pace (a steady speed, whatever the width), pauses it off screen and on the button. */
function bindMarquee(root: HTMLElement) {
  const track = root.querySelector<HTMLElement>('.dt-mq-track')!;
  const btn = root.querySelector<HTMLButtonElement>('.dt-mq-pp')!;
  const SPEED = 36; // px a second
  // The loop is one set, half the track, at SPEED; a resize changes the width, so the pace follows it. It starts once the pictures are
  // decoded, so the pace is not re-set (and the strip does not jump) while they load.
  new ResizeObserver(() => {
    const set = track.getBoundingClientRect().width / 2;
    if (set > 0) track.style.setProperty('--dur', `${(set / SPEED).toFixed(1)}s`);
  }).observe(track);
  void Promise.allSettled([...root.querySelectorAll('img')].map((i) => i.decode())).then(() => root.classList.add('is-ready'));
  new IntersectionObserver(([e]) => root.classList.toggle('is-off', !e.isIntersecting)).observe(root);
  btn.addEventListener('click', () => {
    const paused = root.classList.toggle('is-paused');
    btn.textContent = paused ? 'Play' : 'Pause';
    btn.setAttribute('aria-label', `${paused ? 'Play' : 'Pause'} the pictures`);
  });
}

/** Wires one carousel: the arrows (which wrap round), the dots, the arrow keys and a swipe all move the same scroll-snap track;
    the dots, the count and the spoken status follow wherever it comes to rest. */
function bindCarousel(root: HTMLElement) {
  const track = root.querySelector<HTMLElement>('.dt-track')!;
  const dots = [...root.querySelectorAll<HTMLButtonElement>('.dt-dot')];
  const count = root.querySelector('.dt-count');
  const status = root.querySelector('.dt-sr');
  const n = dots.length;
  let at = 0;
  let frame = 0;
  const show = (k: number) => {
    at = k;
    dots.forEach((d, j) => d.setAttribute('aria-current', String(j === k)));
    if (count) count.textContent = `${k + 1} / ${n}`;
    if (status) status.textContent = `Image ${k + 1} of ${n}`;
  };
  const go = (k: number) => track.scrollTo({ left: ((k + n) % n) * track.clientWidth, behavior: motion.reduced() ? 'auto' : 'smooth' });
  track.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const k = Math.round(track.scrollLeft / track.clientWidth);
        if (k !== at && k >= 0 && k < n) show(k);
      });
    },
    { passive: true },
  );
  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.dt-nav, .dt-dot');
    if (!b) return;
    go(b.dataset.dir ? at + (b.dataset.dir === 'next' ? 1 : -1) : Number(b.dataset.i));
  });
  track.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    go(at + (e.key === 'ArrowRight' ? 1 : -1));
  });
}

export function createDetail(): Detail {
  const dlg = document.createElement('dialog');
  dlg.className = 'detail';
  dlg.setAttribute('aria-labelledby', 'detail-title');
  // Lenis smooth scroll takes every wheel event on the page; the panel scrolls natively instead.
  dlg.setAttribute('data-lenis-prevent', '');
  document.body.append(dlg);
  // The page behind is covered but would still take a wheel that nothing in this one does (content shorter than the
  // screen): hold it, so closing returns to where it was opened.
  dlg.addEventListener(
    'wheel',
    (e) => {
      const s = dlg.querySelector<HTMLElement>('.dt-scroll');
      if (!s || s.scrollHeight <= s.clientHeight) e.preventDefault();
    },
    { passive: false },
  );
  let current: DetailTarget | null = null;
  let closeCb = () => {};
  let navCb: (t: DetailTarget) => void = () => {};
  let inviteCb = () => {};
  // The live figure of the panel showing, if any (and its step chips): torn down when the panel changes or closes.
  let stopLive = () => {};
  let stopRail = () => {};
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
    const p = works.find((x) => x.id === t.id);
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
    let secs: Sec[] = [];
    let actions = '';
    let pager = '';
    if (t.kind === 'project') {
      // Previous and Next go round the page the project is on: the selected five, or the archive.
      const group = isArchive(t.id) ? archiveWorks : selectedWorks;
      const i = group.findIndex((p) => p.id === t.id);
      const p = group[i];
      head = `<p class="dt-eyebrow">${p.flagship ? `<span class="dt-flag">${FLAG_SVG}Flagship</span> · ` : ''}${esc(p.category)} · ${isApp(t.id) ? 'Mobile app' : 'Project'} ${String(i + 1).padStart(2, '0')}/${String(group.length).padStart(2, '0')}</p>
        <h2 id="detail-title">${esc(p.title)}</h2><p class="dt-roles">${p.roles.map(esc).join(' · ')}</p>`;
      secs = projectSections(p, gallery(p.images, p.title, p.motion), flowSection(p.flow));
      actions = `<a class="dt-cta" href="${p.link}" target="_blank" rel="noopener noreferrer">Visit site <span aria-hidden="true">↗</span><span class="dt-sr"> (opens in a new tab)</span></a>`;
      pager = group.length > 1 ? pagerHtml(group, i, 'project') : '';
    } else if (t.kind === 'event') {
      const i = events.findIndex((e) => e.id === t.id);
      const e = events[i];
      head = `<p class="dt-eyebrow">${esc(e.place)} · <strong>${esc(countries[e.country])}</strong></p>
        <h2 id="detail-title">${esc(e.title)}</h2><p class="dt-roles">${esc(e.role)}</p>`;
      secs = eventSections(e, marquee(e.images, e.title));
      actions = `<button type="button" class="dt-cta" data-invite>Invite Dean</button>`;
      pager = pagerHtml(events, i, 'event');
    } else {
      head = `<p class="dt-eyebrow">About</p><h2 id="detail-title">${profile.name}</h2><p class="dt-roles">${profile.roles.join(' · ')}</p>`;
      secs = aboutSections(profile, workflowBody());
      actions = `<button type="button" class="dt-cta" data-invite>Get in touch</button>`;
    }
    dlg.classList.toggle('has-rail', hasRail(secs)); // the frame is wider by the rail (detailPage.css)
    dlg.innerHTML = `<div class="dt-panel">
      <header class="dt-head"><button type="button" class="dt-close" aria-label="Close">‹ Back</button>${actions}</header>
      <div class="dt-scroll">${pageHtml(secs, head, pager)}</div></div>`;
  }

  function pagerHtml(list: readonly { id: string; title: string }[], i: number, kind: 'project' | 'event') {
    const n = list.length;
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
    const go = el.closest<HTMLButtonElement>('[data-go]');
    if (go) navCb({ kind: go.dataset.kind as 'project' | 'event', id: go.dataset.go! });
  });
  // The walkthrough plays unless motion is reduced or the connection is saving data (the poster shows then, and nothing
  // downloads until Play); the button always works. Phones get the smaller file (-sm).
  function startMotion() {
    const v = dlg.querySelector<HTMLVideoElement>('video.dt-main');
    const b = dlg.querySelector<HTMLButtonElement>('.dt-pp');
    if (!v || !b) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const still = motion.reduced() || conn?.saveData === true || /^(slow-)?2g$/.test(conn?.effectiveType ?? '');
    v.src = `${v.dataset.src}${matchMedia('(max-width: 760px)').matches ? '-sm' : ''}.mp4`;
    v.preload = still ? 'none' : 'metadata';
    const sync = () => {
      b.textContent = v.paused ? 'Play' : 'Pause';
      b.setAttribute('aria-label', `${v.paused ? 'Play' : 'Pause'} the walkthrough`);
    };
    v.addEventListener('play', sync);
    v.addEventListener('pause', sync);
    b.addEventListener('click', () => (v.paused ? void v.play() : v.pause()));
    if (!still) v.play().catch(() => {});
    sync();
  }
  dlg.addEventListener('close', () => {
    dlg.querySelector('video')?.pause();
    stopFlow();
    stopRail();
    current = null;
    closeCb();
  });

  return {
    open(t) {
      current = t;
      stopFlow();
      stopRail();
      render(t);
      dlg.querySelectorAll<HTMLElement>('.dt-carousel[role="region"]').forEach(bindCarousel);
      dlg.querySelectorAll<HTMLElement>('.dt-marquee').forEach(bindMarquee);
      startMotion();
      startFlow(t);
      if (!dlg.open) dlg.showModal();
      dlg.querySelector<HTMLElement>('.dt-scroll')?.scrollTo(0, 0);
      stopRail = bindRail(dlg); // once it is showing: a closed dialog has no boxes to measure
      dlg.querySelector<HTMLElement>('.dt-close')?.focus();
    },
    close: () => dlg.open && dlg.close(),
    isOpen: () => current !== null,
    onClose: (cb) => (closeCb = cb),
    onNavigate: (cb) => (navCb = cb),
    onInvite: (cb) => (inviteCb = cb),
  };
}
