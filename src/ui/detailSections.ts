// The sections of a detail page, and the rail that moves between them (docs/device-design.md §54).
// A page is a list of sections (Media, Overview, one chapter per story entry, Design flow …). Each is drawn as a chapter
// with a title, and each is a row on the rail: the device screen's e-ink list in its dark form, the row in view a solid
// bar. Scrolling lights the row; pressing a row scrolls. Under 1200 px the rail is a sticky strip of the same list. The first
// sentence of a paragraph is its lead, larger; the rest is detail, quieter, so a page can be scanned.
import './detailPage.css';
import { isApp, toolLogo, toolNames, type Project, type SpeakingEvent, type ToolId, type profile as Profile } from '../content/portfolio';
import { sfx } from '../audio/sfx';
import { motion } from '../motion';
import { copyText } from './clipboard';

export interface Sec {
  id: string;
  label: string;
  html: string;
  /** Draw the chapter header (number and title) above it: everything but the hero. */
  head?: boolean;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pad = (n: number) => String(n).padStart(2, '0');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const tool = (t: string) =>
  `<li class="dt-tool"><img src="${toolLogo(t)}" alt="" width="20" height="20"><span>${toolNames[t as ToolId] ?? t}</span></li>`;
const stackChip = (t: string) => `<li class="dt-tool dt-stack">${esc(t)}</li>`;
const newTab = '<span aria-hidden="true">↗</span><span class="dt-sr"> (opens in a new tab)</span>';

/** The first sentence, and the rest. */
export function splitLead(text: string): [string, string] {
  const m = text.match(/^(.+?[.!?])\s+([\s\S]+)$/);
  return m ? [m[1], m[2]] : [text, ''];
}
const leadHtml = (text: string, extra = '') => {
  const [lead, rest] = splitLead(text);
  return `<p class="dt-lead">${esc(lead)}</p>${rest || extra ? `<p class="dt-detail">${esc(rest)}${extra ? ` ${esc(extra)}` : ''}</p>` : ''}`;
};

// ---- figures beside the text -----------------------------------------------------------------------------------------

/** One of the work's own pictures, numbered like a plate. */
const plate = (p: Project, k: number) =>
  `<figure class="dt-plate"><img src="${p.images[k % p.images.length]}" alt="${esc(p.title)}, screenshot ${(k % p.images.length) + 1}" loading="lazy" decoding="async"><figcaption>Fig ${pad(k + 1)} · ${esc(p.title)}</figcaption></figure>`;

/** Every project's story has the chapters of Kairma's page, in this order: The problem, The idea, Why this look, How it was built (a chapter
    a project has no text for is left out). The problem and the idea get an animated diagram in place of a screenshot: a Rubik's cube that
    ends on a question mark, and a laptop that lights up with a bulb on its screen (src/figures/story). detail.ts mounts them once the
    panel is open and tears them down when it closes. */
export type DiagramKind = 'problem' | 'idea';
export function diagramOf(label: string): DiagramKind | null {
  const l = label.replace(/^the\s+/i, '').toLowerCase();
  return l === 'problem' ? 'problem' : l === 'idea' ? 'idea' : null;
}
/** The figures' box shapes (W / H in cube.mjs and laptop.mjs, which fit their box to their content), so the slot is the right height before the figure loads. */
const DIAGRAM_SHAPE: Record<DiagramKind, string> = { problem: '520 / 443', idea: '520 / 405' };
const diagram = (kind: DiagramKind, p: Project, n: number) =>
  `<figure class="dt-plate dt-diagram"><div class="dt-diagram-stage" data-story="${kind}" style="aspect-ratio:${DIAGRAM_SHAPE[kind]}"></div><figcaption>Fig ${pad(n)} · ${esc(p.title)}</figcaption></figure>`;

/** The palette and typefaces the live site uses (measured, not described). Each colour is a button: hover shows "Copy", a press copies its hex
    (copySwatch); on touch the tag is always there. */
function lookFigure(p: Project) {
  const l = p.look!;
  const swatches = (list: { name: string; hex: string }[]) =>
    `<ul class="dt-swatches${list.length > 4 ? ' dense' : ''}">${list.map((c) => `<li><button type="button" class="dt-sw" data-hex="${c.hex}" aria-label="Copy ${esc(c.name)}, ${c.hex}"><i style="background:${c.hex}"><em class="dt-sw-tag" aria-hidden="true">Copy</em></i><b>${esc(c.name)}</b><code>${c.hex}</code></button></li>`).join('')}</ul>`;
  // A site with a light theme shows both, each under its own small label.
  const palette = l.light ? `<p class="dt-look-sub">Dark theme</p>${swatches(l.palette)}<p class="dt-look-sub">Light theme</p>${swatches(l.light)}` : swatches(l.palette);
  return `<div class="dt-look" role="group" aria-label="Palette and fonts of ${esc(p.title)}">
    <p class="dt-look-h">Palette</p>
    ${palette}
    <p class="dt-look-h">Font</p>
    <ul class="dt-faces">${l.type.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <p class="dt-sr" role="status"></p></div>`;
}

/** Copies a swatch's hex: the same copy and the same detent as the contact card's Copy, the tag saying Copied for a moment and a
    spoken line for a screen reader. Only one swatch shows its result at a time. */
let swatchTimer = 0;
export async function copySwatch(btn: HTMLElement) {
  const root = btn.closest<HTMLElement>('.dt-look');
  const hex = btn.dataset.hex;
  if (!root || !hex) return;
  const ok = await copyText(hex);
  sfx.play(ok ? 'detent' : 'toggle', ok ? {} : { rate: 0.8 });
  const status = root.querySelector<HTMLElement>('[role="status"]');
  const reset = () => {
    root.querySelectorAll<HTMLElement>('.dt-sw[data-state]').forEach((b) => {
      delete b.dataset.state;
      b.querySelector('.dt-sw-tag')!.textContent = 'Copy';
    });
    if (status) status.textContent = '';
  };
  reset();
  btn.dataset.state = ok ? 'done' : 'fail';
  btn.querySelector('.dt-sw-tag')!.textContent = ok ? 'Copied' : 'Failed';
  if (status) status.textContent = ok ? `${hex} copied` : 'Couldn’t copy the colour.';
  clearTimeout(swatchTimer);
  swatchTimer = window.setTimeout(reset, 1800);
}

/** What it was built with: the tools, then the stack. */
const builtFigure = (p: Project) =>
  `<div class="dt-look" role="group" aria-label="Tools and stack of ${esc(p.title)}">
    <p class="dt-look-h">Tools</p><ul class="dt-tools">${p.tools.map(tool).join('')}</ul>
    <p class="dt-look-h">Stack</p><ul class="dt-tools">${p.stack.map(stackChip).join('')}</ul></div>`;

// ---- the sections of each kind of page ---------------------------------------------------------------------------------

/** Role, team, category, network, tools, stack: the facts, for a glance. Team is Solo unless the project has one; Dean's own role in it is highlighted. */
function glance(p: Project) {
  const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const member = (m: { role: string; me?: boolean }) => `<li class="dt-tool${m.me ? ' dt-me' : ''}">${esc(m.role)}${m.me ? '<span class="dt-sr"> (my role)</span>' : ''}</li>`;
  return `<dl class="dt-glance" aria-label="At a glance">
    ${row('Role', esc(p.roles.join(' · ')))}
    ${row('Team', `<ul class="dt-tools">${(p.team ?? [{ role: 'Solo' }]).map(member).join('')}</ul>`)}
    ${row('Category', `${esc(p.category)}${isApp(p.id) ? ' · Mobile app' : ''}`)}
    ${p.chain ? row('Network', `<ul class="dt-tools"><li class="dt-tool dt-stack"><img src="${p.chain.logo}" alt="" width="18" height="18"><span>${esc(p.chain.name)}</span></li></ul>`) : ''}
    ${row('Tools', `<ul class="dt-tools">${p.tools.map(tool).join('')}</ul>`)}
    ${row('Stack', `<ul class="dt-tools">${p.stack.map(stackChip).join('')}</ul>`)}
    ${p.original ? row('Production app', `<a class="dt-orig" href="${p.original.link}" target="_blank" rel="noopener noreferrer">${esc(p.original.title)} ${newTab}</a>`) : ''}</dl>`;
}

export function projectSections(p: Project, media: string, flow: string): Sec[] {
  const secs: Sec[] = [
    { id: 'media', label: 'Media', head: false, html: media },
    { id: 'overview', label: 'Overview', html: `<div class="dt-ov"><div>${leadHtml(p.description)}</div>${glance(p)}</div>` },
  ];
  let k = 1; // the next of the work's own pictures to hang beside a chapter
  for (const s of p.story ?? []) {
    const look = s.label === 'Why this look' && p.look;
    const built = /built/i.test(s.label);
    const kind = diagramOf(s.label);
    const fig = look ? lookFigure(p) : built ? builtFigure(p) : kind ? diagram(kind, p, kind === 'problem' ? 1 : 2) : plate(p, k++);
    secs.push({ id: slug(s.label), label: cap(s.label.replace(/^the\s+/i, '')), html: `<div class="dt-ch has-fig"><div>${leadHtml(s.text)}</div><div class="dt-ch-fig">${fig}</div></div>` });
  }
  secs.push({ id: 'flow', label: 'Design flow', html: flow });
  return secs;
}

export function eventSections(e: SpeakingEvent, media: string): Sec[] {
  // Each organisation is only its official logo on a tile, linking to its official site (a text link where there is no logo). The tile is light
  // unless the logo needs a dark or white one; the group has no visible label, only a name for a screen reader.
  const links = e.links
    ? `<div class="dt-orgs" role="group" aria-label="${esc(e.linksLabel ?? 'Official sites')}">${e.links
        .map((l) =>
          l.logo
            ? `<a class="dt-org"${l.tile ? ` data-tile="${l.tile}"` : ''}${l.mark ? ' data-mark' : ''} href="${l.link}" target="_blank" rel="noopener noreferrer"><img src="${l.logo}" alt="${esc(l.title)}" width="168" height="30" loading="lazy" decoding="async"><span class="dt-org-go" aria-hidden="true">↗</span><span class="dt-sr"> official site (opens in a new tab)</span></a>`
            : `<a class="dt-orig" href="${l.link}" target="_blank" rel="noopener noreferrer">${esc(l.title)} ${newTab}</a>`,
        )
        .join('')}</div>`
    : '';
  // The conclusion closes the overview, in the same section, so the page stays at two sections (no rail).
  const concl = `<div class="dt-concl"><p class="dt-look-h">Conclusion</p><p class="dt-detail">${esc(e.conclusion)}</p></div>`;
  return [
    { id: 'media', label: 'Media', head: false, html: media },
    { id: 'overview', label: 'Overview', html: `<div class="dt-ov${links ? '' : ' solo'}"><div>${leadHtml(e.description)}</div>${links}</div>${concl}` },
  ];
}

export function aboutSections(p: typeof Profile, workflow: string): Sec[] {
  const [first, ...more] = p.bio;
  return [
    {
      id: 'about',
      label: 'About',
      head: false,
      html: `<div class="dt-abt"><div class="dt-media"><img class="dt-main dt-portrait" src="${p.portrait.color}" alt="Dean speaking on stage with a microphone"></div><div>${leadHtml(first, more.join(' '))}</div></div>`,
    },
    { id: 'how', label: 'How I work', html: `<div class="dt-flow dt-wf">${workflow}</div>` },
    {
      // Tools and Languages are short, so they sit side by side with a rule between them (stacked on a narrow page).
      id: 'tools',
      label: 'Tools & languages',
      html: `<div class="dt-duo">
        <div class="dt-duo-a">${p.toolGroups.map((g) => `<div class="dt-grp"><p class="dt-look-h">${esc(g.title)}</p><ul class="dt-tools">${g.tools.map(tool).join('')}</ul></div>`).join('')}</div>
        <span class="dt-duo-rule" aria-hidden="true"></span>
        <div class="dt-duo-b"><div class="dt-grp"><p class="dt-look-h">Languages</p><ul class="dt-tools">${p.languages.map((l) => `<li class="dt-tool"><img src="${l.flag}" alt="" width="20" height="14"><span>${l.name}</span></li>`).join('')}</ul></div></div></div>`,
    },
  ];
}

// ---- the page, and the rail ------------------------------------------------------------------------------------------

/** The rail needs something to move between. */
export const hasRail = (secs: Sec[]) => secs.length >= 3;

function railHtml(secs: Sec[]) {
  return `<nav class="dt-rail" aria-label="On this page">
    <p class="dt-rail-t" aria-hidden="true">Contents</p>
    <ol class="dt-keys">${secs
      .map(
        (s, i) =>
          `<li><button type="button" class="dt-key" data-to="${s.id}"${i === 0 ? ' aria-current="location"' : ''}><span class="dt-key-n" aria-hidden="true">${pad(i + 1)}</span><span class="dt-key-l">${esc(s.label)}</span></button></li>`,
      )
      .join('')}</ol></nav>`;
}

/** The scroll area's content: the rail (when there is something to move between), then the head, the sections and the pager.
    A section's heading has no number: the rail's keys carry them. */
export function pageHtml(secs: Sec[], head: string, pager: string) {
  const body = secs
    .map(
      (s) =>
        `<div class="dt-sec" id="dt-s-${s.id}" data-label="${esc(s.label)}" tabindex="-1">${s.head === false ? '' : `<header class="dt-ch-h"><h3 class="dt-ch-t">${esc(s.label)}</h3></header>`}${s.html}</div>`,
    )
    .join('');
  return `<div class="dt-page">${hasRail(secs) ? railHtml(secs) : ''}<div class="dt-main-col">${head}${body}${pager}</div></div>`;
}

/** Wires the rail: scrolling lights the key of the section in view, a key press scrolls to its section. Returns a teardown. */
export function bindRail(dlg: HTMLElement): () => void {
  const scroller = dlg.querySelector<HTMLElement>('.dt-scroll');
  const rail = dlg.querySelector<HTMLElement>('.dt-rail');
  if (!scroller || !rail) return () => {};
  const secs = [...dlg.querySelectorAll<HTMLElement>('.dt-sec')];
  const list = rail.querySelector<HTMLElement>('.dt-keys')!;
  const keys = [...rail.querySelectorAll<HTMLButtonElement>('.dt-key')];
  let at = -1;
  let frame = 0;
  const set = (k: number) => {
    if (k === at) return;
    at = k;
    keys.forEach((b, i) => (i === k ? b.setAttribute('aria-current', 'location') : b.removeAttribute('aria-current')));
    // As a strip the keys scroll sideways: keep the lit one in view.
    if (list.scrollWidth > list.clientWidth + 1) {
      const b = keys[k];
      list.scrollTo({ left: b.offsetLeft - (list.clientWidth - b.offsetWidth) / 2, behavior: motion.reduced() ? 'auto' : 'smooth' });
    }
  };
  /** The section in view is the last one whose top has passed a line a third of the way down the page. */
  const measure = () => {
    const box = scroller.getBoundingClientRect();
    const line = box.top + scroller.clientHeight * 0.33;
    let k = 0;
    secs.forEach((s, i) => {
      if (s.getBoundingClientRect().top <= line) k = i;
    });
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) k = secs.length - 1;
    set(k);
  };
  const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  rail.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.dt-key');
    const s = b && dlg.querySelector<HTMLElement>(`#dt-s-${b.dataset.to}`);
    if (!b || !s) return;
    sfx.play('press', { rate: 1.15, volume: 0.6 });
    s.scrollIntoView({ behavior: motion.reduced() ? 'auto' : 'smooth', block: 'start' });
    s.focus({ preventScroll: true });
  });
  measure();
  return () => {
    cancelAnimationFrame(frame);
    scroller.removeEventListener('scroll', onScroll);
  };
}
