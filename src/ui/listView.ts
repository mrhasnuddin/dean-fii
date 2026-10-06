// List view: the whole portfolio as a plain page, no 3D (Contra's "spreadsheet" view). Chosen with the
// Device / List switch (bottom-right) or the wallet's side switch; also the fallback without WebGL.
// Same content and routes as the device: every item opens the same detail panel (#/work/:id …).
import './listView.css';
import { countries, events, profile, projects, toolLogo, toolNames } from '../content/portfolio';
import { createContactCard } from './contactCard';

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

/** Fills the list view container once (images load lazily, only when the view is shown). */
export function buildListView(root: HTMLElement): void {
  if (root.childElementCount) return;
  const tools = profile.toolGroups.flatMap((g) => g.tools);
  root.innerHTML = `
    <header class="lv-head">
      <p class="lv-kicker">Dean Studio</p>
      <h1 class="lv-title"><span class="h-sans">Dean</span> <span class="h-serif">Studio.</span></h1>
      <p class="lv-lede">UI/UX designer, frontend developer and creative designer, focused on making complex Web3 products understandable through interfaces, landing pages and frontend implementation.</p>
      <nav class="lv-nav" aria-label="Sections">
        <a href="#lv-works">Works</a><a href="#lv-chronicle">Events</a><a href="#lv-about">About</a><a href="#lv-contact">Contact</a>
      </nav>
    </header>

    <section class="lv-sec" id="lv-works" aria-labelledby="lv-works-h">
      <h2 id="lv-works-h">Selected works</h2>
      <ul class="lv-grid">${projects
        .map((p) => `<li><a href="#/work/${p.id}">
          <img src="${p.images[0]}" alt="" loading="lazy" decoding="async" width="640" height="400">
          <span class="lv-meta">${esc(p.category)}</span>
          <strong>${esc(p.title)}</strong>
          <span class="lv-sub">${esc(p.roles.join(' · '))}</span></a></li>`)
        .join('')}</ul>
      <p class="lv-soon"><strong>Mobile apps</strong> <span>Coming soon</span> Mobile app design and development.</p>
    </section>

    <section class="lv-sec" id="lv-chronicle" aria-labelledby="lv-chronicle-h">
      <h2 id="lv-chronicle-h">Events</h2>
      <ul class="lv-rows">${events
        .map((e) => `<li><a href="#/stage/${e.id}">
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
    </div>`;
  root.querySelector('.lv-card')!.append(createContactCard('card'));
}
