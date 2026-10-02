// Detail panel for a project, an event or About: a native <dialog> (focus trap, Esc, inert page for
// free). Slides in over the text column so the wallet stays visible; bottom sheet on phones.
import './detail.css';
import { countries, events, profile, projects, toolLogo, toolNames, type ToolId } from '../content/portfolio';

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
    current = null;
    closeCb();
  });

  return {
    open(t) {
      current = t;
      render(t);
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
