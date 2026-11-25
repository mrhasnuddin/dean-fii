// List view: the whole portfolio as a plain page, no 3D (Contra's "spreadsheet" view). Chosen with the
// Device / List switch (bottom-right) or the wallet's side switch; also the fallback without WebGL.
// Same content and routes as the device: every item opens the same detail panel (#/work/:id …).
import './listView.css';
import { FLAG_SVG } from '../brand/logo';
import { countries, events, isApp, profile, toolLogo, toolNames, works, type Project } from '../content/portfolio';
import { createContactCard } from './contactCard';
import { mountHoverPeek } from './hoverPeek';
import { mountWorkflowSection, workflowBody } from './workflowSection';

export type ViewMode = 'device' | 'list';
const KEY = 'dean-view';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function storedView(): ViewMode {
  try {
    return localStorage.getItem(KEY) === 'list' ? 'list' : 'device';
  } catch {
    return 'device';
  }
}
export function storeView(v: ViewMode) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode: lasts for this visit */
  }
}

/** The kinds of project the Works list is grouped by, in the order they are shown: each is a heading, and the `tags[0]` values that go under it. */
const GROUPS: { title: string; tags: string[] }[] = [
  { title: 'Landing pages', tags: ['Landing Page'] },
  { title: 'Dapps', tags: ['Dapp Redesign', 'Dapp'] },
  { title: 'Web apps', tags: ['Web App', 'Marketplace Site'] },
  { title: 'Company sites', tags: ['Brand Site', 'Corporate Site'] },
];
const LAYOUT_KEY = 'dean-works-layout';
type Layout = 'grid' | 'list';
const storedLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};
const layoutIcon = { grid: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z', list: 'M2 3h12M2 8h12M2 13h12' };

const statusPill = (s: string) => `<span class="lv-status" data-status="${/^live$/i.test(s) ? 'live' : 'shipped'}"><i aria-hidden="true"></i>${esc(s)}</span>`;

/** One work as a card (or, in the List layout, a row). The line above the title is the kind of project (tags[0], the same as on the
    device); the mobile app says so. */
const card = (p: Project) => `<li><a href="#/work/${p.id}">${p.flagship ? `<span class="lv-flag">${FLAG_SVG}Flagship</span>` : ''}
          <img src="${p.images[0]}" alt="" loading="lazy" decoding="async" width="640" height="400">
          <span class="lv-meta">${esc(p.tags[0])}${isApp(p.id) ? ' · Mobile app' : ''}${statusPill(p.status)}</span>
          <strong>${esc(p.title)}</strong>
          <span class="lv-sub">${esc(p.roles.join(' · '))}</span></a></li>`;

/** Fills the list view container once (images load lazily, only when the view is shown). */
export function buildListView(root: HTMLElement): void {
  if (root.childElementCount) return;
  const tools = profile.toolGroups.flatMap((g) => g.tools);
  root.innerHTML = `
    <header class="lv-head">
      <h1 class="lv-title"><span class="h-sans">Dean</span> <span class="h-serif">Studio.</span></h1>
      <p class="lv-lede">AI-native designer who also ships the frontend, so there’s no handoff between design and build. UI/UX and creative design that make complex Web3 products easy to understand.</p>
      <nav class="lv-nav" aria-label="Sections">
        <a href="#lv-works">Works</a><a href="#lv-chronicle">Events</a><a href="#lv-about">About</a><a href="#lv-contact">Contact</a>
      </nav>
    </header>

    <section class="lv-sec lv-works" id="lv-works" aria-labelledby="lv-works-h" data-layout="${storedLayout()}">
      <div class="lv-sec-head">
        <h2 id="lv-works-h">Works</h2>
        <div class="lv-layout" role="group" aria-label="Layout">${(['grid', 'list'] as const)
          .map((l) => `<button type="button" data-layout="${l}" aria-pressed="${l === storedLayout()}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${layoutIcon[l]}"/></svg>${l === 'grid' ? 'Grid' : 'List'}</button>`)
          .join('')}</div>
      </div>
      ${GROUPS.map((g) => ({ g, items: works.filter((p) => g.tags.includes(p.tags[0])) }))
        .filter(({ items }) => items.length)
        .map(({ g, items }) => `<h3 class="lv-cat">${g.title}<b>${items.length}</b></h3><ul class="lv-grid">${items.map(card).join('')}</ul>`)
        .join('')}
    </section>

    <section class="lv-sec" id="lv-chronicle" aria-labelledby="lv-chronicle-h">
      <h2 id="lv-chronicle-h">Events</h2>
      <ul class="lv-rows">${events
        .map((e) => `<li><a href="#/stage/${e.id}" data-peek="${e.id}">
          <span class="lv-meta">${esc(e.place)}, ${esc(countries[e.country] ?? e.country)}</span>
          <strong>${esc(e.title)}</strong>
          <span class="lv-sub">${esc(e.role)}</span></a></li>`)
        .join('')}</ul>
    </section>

    <!-- About and Get in touch share one row (60 / 40): the contact details are short, so a
         full-width band left most of it empty. -->
    <div class="lv-pair">
    <section class="lv-sec lv-about" id="lv-about" aria-labelledby="lv-about-h">
      <h2 id="lv-about-h">About Dean</h2>
      <div class="lv-about-body">
        <img class="lv-portrait" src="${profile.portrait.color}" alt="Dean on stage, speaking" loading="lazy" width="400" height="500">
        <div>
          <p class="lv-roles">${profile.roles.join(' · ')}</p>
          ${profile.bio.map((b) => `<p>${esc(b)}</p>`).join('')}
          <h3>Tools</h3>
          <ul class="lv-chips">${tools.map((t) => `<li><img src="${toolLogo(t)}" alt="" width="18" height="18">${toolNames[t]}</li>`).join('')}</ul>
          <h3>Languages</h3>
          <ul class="lv-chips">${profile.languages.map((l) => `<li><img src="${l.flag}" alt="" width="18" height="18">${l.name}</li>`).join('')}</ul>
        </div>
      </div>
    </section>

    <section class="lv-sec lv-contact" id="lv-contact" aria-labelledby="lv-contact-h">
      <h2 id="lv-contact-h">Get in touch</h2>
      <p class="lv-contact-lede">Email, LinkedIn or WhatsApp.</p>
      <div class="lv-card"></div>
    </section>
    </div>

    <section class="lv-sec lv-wf dt-wf" id="lv-how" aria-labelledby="lv-how-h">
      <h2 id="lv-how-h">How I work</h2>
      ${workflowBody(3)}
    </section>`;
  root.querySelector('.lv-card')!.append(createContactCard('card'));
  // Events: a thumbnail of the event follows the pointer over its row (thumbnails in public/media/peek/<id>.webp).
  mountHoverPeek(root, root.querySelector<HTMLElement>('.lv-rows')!, (id) => `/media/peek/${id}.webp`);
  // The workflow figure stays mounted with the list; it sleeps whenever the list is hidden or scrolled away.
  // Works: Grid or List, remembered for the next visit.
  const works$ = root.querySelector<HTMLElement>('#lv-works')!;
  works$.querySelector('.lv-layout')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-layout]');
    if (!b) return;
    works$.dataset.layout = b.dataset.layout;
    works$.querySelectorAll('.lv-layout button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    try {
      localStorage.setItem(LAYOUT_KEY, b.dataset.layout!);
    } catch {
      /* private mode: lasts for this visit */
    }
  });
  mountWorkflowSection(root.querySelector<HTMLElement>('.lv-wf')!);
}
