// The wallet's e-ink screen for the whole site (360 × 480 CSS px, mounted with CSS3DRenderer).
// One mode per section. The roller moves the selection (partial refresh: instant, no flash); a mode
// change does a full refresh flash, like a real e-ink panel. `confirm()` returns what ✓ should do.
// Idle: the Hello screen is the pixel D-star; any other screen falls back to it after IDLE_MS with
// no input anywhere, and wakes on the next pointer move, key, wheel, scroll or touch.
import './einkScreen.css';
import './screen.css';
import { LOGO_PATHS } from '../brand/logo';
import { createPixelLogo } from './pixelLogo';
import { contact, emailDisplay, phoneDisplay } from '../content/contact';
import { countries, events, profile, projects, toolNames } from '../content/portfolio';
import { sfx } from '../audio/sfx';
import { motion } from '../motion';

export type ScreenMode = 'boot' | 'hello' | 'works' | 'chronicle' | 'about' | 'contact';
export type ContactState = 'prompt' | 'reading' | 'verified';
export type ScreenIntent =
  | { type: 'project'; id: string }
  | { type: 'event'; id: string }
  | { type: 'about' }
  | { type: 'contact' }
  | { type: 'channel'; channel: 'email' | 'whatsapp' | 'linkedin' }
  | { type: 'tab'; tab: 'works' | 'chronicle' | 'about' | 'contact' }
  /** A face-key label on the bottom edge was tapped: press that key. */
  | { type: 'key'; key: 'back' | 'confirm' }
  | { type: 'none' };

export interface Screen {
  el: HTMLElement;
  mode(): ScreenMode;
  setMode(mode: ScreenMode): void;
  /** Roller step. Returns false at a list end (so the caller can let the page scroll instead). */
  move(delta: number): boolean;
  selectedIndex(): number;
  select(index: number): void;
  confirm(): ScreenIntent;
  setContactState(state: ContactState): void;
  /** Row click/tap on the screen: select, or confirm if already selected. */
  onIntent(cb: (intent: ScreenIntent) => void): void;
  onSelect(cb: (index: number) => void): void;
  flash(): void;
}

const LABEL: Record<ScreenMode, string> = {
  boot: 'DEAN STUDIO', hello: 'HELLO', works: 'WORKS', chronicle: 'CHRONICLE', about: 'ABOUT', contact: 'CONTACT',
};
const CHANNELS = [
  { id: 'email', name: 'Email', detail: emailDisplay() },
  { id: 'whatsapp', name: 'WhatsApp', detail: phoneDisplay() },
  { id: 'linkedin', name: 'LinkedIn', detail: contact.linkedin.label },
] as const;
// Touch screens get taller rows (screen.css, same query), so one fewer fits.
const COARSE = matchMedia('(pointer: coarse)');
const visibleRows = () => (COARSE.matches ? 5 : 6);
// Softkey labels: the top row sits directly under the wallet's four top tabs (x in W from the spec's
// TABS_X; the screen is 0.795 W = 360 px wide), so each label names the tab above it.
const SOFTKEYS = [
  { tab: 'works', x: -0.25 },
  { tab: 'chronicle', x: -0.085 },
  { tab: 'about', x: 0.085 },
  { tab: 'contact', x: 0.25 },
] as const;
const PX_PER_W = 360 / 0.795;
const IDLE_MS = 25_000;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Card reader glyph: the wallet in profile with the key half inserted in its side slot; the arrow
// blinks in e-ink steps.
const readerGlyph = `
<svg class="ek-nfc" viewBox="0 0 120 90" aria-hidden="true">
  <rect x="10" y="6" width="46" height="78" rx="7" class="ek-nfc-wallet"/>
  <rect x="44" y="38" width="58" height="22" rx="3" class="ek-nfc-card"/>
  <path class="ek-arc a1" d="M114 49h-8m0 0 5-5m-5 5 5 5"/>
</svg>`;

export function createScreen(): Screen {
  const el = document.createElement('div');
  el.className = 'eink screen';
  let current: ScreenMode = 'boot';
  let contactState: ContactState = 'prompt';
  const logo = createPixelLogo();
  const saver = document.createElement('div');
  saver.className = 'sc-saver';
  saver.hidden = true;
  saver.innerHTML = `<div class="sc-mark"></div><p class="sc-caption">Dean Studio</p>`;
  const index: Record<'works' | 'chronicle' | 'contact', number> = { works: 0, chronicle: 0, contact: 0 };
  let intentCb: (i: ScreenIntent) => void = () => {};
  let selectCb: (i: number) => void = () => {};

  let flashTimer = 0;
  const flash = () => {
    if (motion.reduced()) return;
    clearTimeout(flashTimer);
    el.classList.add('ek-flash');
    flashTimer = window.setTimeout(() => {
      el.classList.remove('ek-flash');
      flashTimer = window.setTimeout(() => {
        el.classList.add('ek-flash');
        flashTimer = window.setTimeout(() => el.classList.remove('ek-flash'), 60);
      }, 50);
    }, 70);
  };
  // Full refresh (mode or contact state change): the double flash plus its faint e-ink swish.
  // Sound isn't motion, so the swish stays when motion is reduced.
  const refresh = () => {
    sfx.play('eink');
    flash();
  };

  // One pixel logo, mounted wherever the idle mark is showing (Hello, or the idle overlay).
  function mountLogo() {
    const slot = !saver.hidden ? saver.querySelector('.sc-mark') : el.querySelector('.sc-home .sc-mark');
    if (slot) {
      slot.append(logo.el);
      logo.start();
    } else logo.stop();
  }
  // Idle overlay: lists and About fall back to the mark after IDLE_MS without input. Appearing is
  // silent (nobody asked for it); waking plays the refresh swish, since the visitor caused it.
  let idleTimer = 0;
  const idleable = () => current === 'works' || current === 'chronicle' || current === 'about' || (current === 'contact' && contactState === 'prompt');
  function sleep() {
    if (!idleable()) return;
    saver.hidden = false;
    flash();
    mountLogo();
  }
  function wake() {
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(sleep, IDLE_MS);
    if (saver.hidden) return;
    saver.hidden = true;
    refresh();
    mountLogo();
  }
  for (const t of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const) {
    addEventListener(t, wake, { passive: true, capture: true });
  }
  wake();

  const listLen = () => (current === 'works' ? projects.length : current === 'chronicle' ? events.length : current === 'contact' ? CHANNELS.length : 0);
  const listKey = () => (current === 'works' || current === 'chronicle' || current === 'contact' ? current : null);

  function windowed<T>(items: readonly T[], sel: number): { item: T; i: number }[] {
    const rows = visibleRows();
    const start = Math.max(0, Math.min(sel - Math.floor(rows / 2), items.length - rows));
    return items.slice(start, start + rows).map((item, k) => ({ item, i: start + k }));
  }

  function softkeys() {
    return `<header class="ek-sb ek-soft">${SOFTKEYS.map(({ tab, x }, i) => {
      const on = tab === current;
      return `<span data-softkey="${tab}" class="${on ? 'on' : ''}" style="left:${(180 + x * PX_PER_W).toFixed(1)}px">0${i + 1}${on ? ` ${LABEL[tab]}` : ''}</span>`;
    }).join('')}</header>`;
  }

  // Bottom edge: labels for the two face keys under it (‹ Back, ✓). They are tappable too: on a phone the
  // label is the bigger target, and it is what people try first.
  function footer(left: string, mid: string, right: string) {
    const ok = right === '…' ? '' : ' data-key="confirm"';
    return `<footer class="ek-ab"><span data-key="back">${left}</span><span>${mid}</span><span class="ek-hold"${ok}>${right}</span></footer>`;
  }

  function render() {
    const sb = (right = '<span class="ek-bat" aria-hidden="true"></span>') =>
      `<header class="ek-sb"><span>${LABEL[current]}</span>${right}</header>`;
    let html = '';
    switch (current) {
      case 'boot': // under the page loader: a still mark until the wallet arrives
        html = `<section class="ek-view sc-center">
          <svg class="sc-logo" viewBox="0 0 100 100" aria-hidden="true">${LOGO_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>
          <p class="sc-kicker">DEAN STUDIO</p></section>`;
        break;
      case 'hello': // home screen: the pixel D-star idles here (status bar only: no section yet)
        html = `${sb()}<section class="ek-view sc-home"><div class="sc-mark"></div><p class="sc-caption">Dean Studio</p></section>
          <footer class="ek-ab"><span data-softkey="works">01 Works</span><span>Scroll ↓</span><span class="ek-hold" data-softkey="contact">04 Contact</span></footer>`;
        break;
      case 'works': {
        const sel = index.works;
        const p = projects[sel];
        html = `${softkeys()}
          <section class="ek-view sc-list">
            <figure class="sc-well"><img src="${p.eink}" alt="" draggable="false"><figcaption>${esc(p.category)}</figcaption></figure>
            <ul class="ek-list sc-rows">${windowed(projects, sel)
              .map(({ item, i }) => `<li data-index="${i}" class="${i === sel ? 'sel' : ''}"><span>${esc(item.title)}</span><small>${esc(item.tags[0])}</small></li>`)
              .join('')}</ul></section>
          ${footer('‹ Back', `${sel + 1} of ${projects.length}`, 'Open ✓')}`;
        break;
      }
      case 'chronicle': {
        const sel = index.chronicle;
        const e = events[sel];
        html = `${softkeys()}
          <section class="ek-view sc-list">
            <figure class="sc-well"><img src="${e.eink}" alt="" draggable="false"><figcaption>${esc(countries[e.country].toUpperCase())} · ${e.country}</figcaption></figure>
            <ul class="ek-list sc-rows">${windowed(events, sel)
              .map(({ item, i }) => `<li data-index="${i}" class="${i === sel ? 'sel' : ''}"><span>${esc(item.place)}</span><small>${esc(item.role)}</small></li>`)
              .join('')}</ul></section>
          ${footer('‹ Back', `${sel + 1} of ${events.length}`, 'Open ✓')}`;
        break;
      }
      case 'about':
        html = `${softkeys()}<section class="ek-view sc-about">
          <div class="sc-id"><img class="sc-portrait" src="${profile.portrait.eink}" alt="" draggable="false"><p>${profile.roles.join('<br>')}</p></div>
          <p class="ek-grp">TOOLS</p><p class="sc-chips">${profile.toolGroups.flatMap((g) => g.tools).map((t) => `<span>${toolNames[t]}</span>`).join('')}</p>
          <p class="ek-grp">LANGUAGES</p><p class="sc-chips">${profile.languages.map((l) => `<span>${l.name}</span>`).join('')}</p></section>
          ${footer('‹ Back', '—', 'Read ✓')}`;
        break;
      case 'contact':
        if (contactState === 'prompt') {
          html = `${softkeys()}<section class="ek-view sc-center">${readerGlyph}<p class="ek-title">Contact Dean</p><p class="ek-sub">Press ✓ and Dean’s key goes into the reader.</p></section>
            ${footer('‹ Back', '—', 'Insert ✓')}`;
        } else if (contactState === 'reading') {
          html = `${softkeys()}<section class="ek-view sc-center sc-reading"><p class="ek-title">Writing details…</p><div class="ek-bar"><i></i></div><p class="ek-sub">Keep the key in.</p></section>
            ${footer('‹ Back', '—', '…')}`;
        } else {
          const sel = index.contact;
          html = `${softkeys()}<section class="ek-view sc-list"><p class="ek-title">Key written <span aria-hidden="true">✓</span></p><p class="ek-grp">SEND VIA</p>
            <ul class="ek-list">${CHANNELS.map((c, i) => `<li data-index="${i}" class="${i === sel ? 'sel' : ''}"><span>${c.name}</span><small>${esc(c.detail)}</small></li>`).join('')}</ul></section>
            ${footer('‹ Back', `${sel + 1} of 3`, 'Open ✓')}`;
        }
        break;
    }
    el.dataset.mode = current;
    el.innerHTML = html;
    el.append(saver);
    mountLogo();
    if (current === 'contact' && contactState === 'reading') {
      // Start the stepped bar on the next frame so the clip-path transition runs from empty.
      requestAnimationFrame(() => el.querySelector('.sc-reading')?.classList.add('go'));
    }
  }

  function confirm(): ScreenIntent {
    switch (current) {
      case 'works': return { type: 'project', id: projects[index.works].id };
      case 'chronicle': return { type: 'event', id: events[index.chronicle].id };
      case 'about': return { type: 'about' };
      case 'contact':
        return contactState === 'verified' ? { type: 'channel', channel: CHANNELS[index.contact].id } : contactState === 'prompt' ? { type: 'contact' } : { type: 'none' };
      default: return { type: 'none' };
    }
  }

  el.addEventListener('click', (e) => {
    const faceKey = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    if (faceKey) return intentCb({ type: 'key', key: faceKey.dataset.key as 'back' | 'confirm' });
    const soft = (e.target as HTMLElement).closest<HTMLElement>('[data-softkey]');
    if (soft) return intentCb({ type: 'tab', tab: soft.dataset.softkey as (typeof SOFTKEYS)[number]['tab'] });
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    const key = listKey();
    if (!row || !key) {
      if (current === 'about' || (current === 'contact' && contactState === 'prompt')) intentCb(confirm());
      return;
    }
    const i = Number(row.dataset.index);
    if (i === index[key]) intentCb(confirm());
    else {
      index[key] = i;
      render();
      selectCb(i);
    }
  });

  render();
  COARSE.addEventListener('change', render); // a hybrid device switching between touch and mouse
  return {
    el,
    mode: () => current,
    setMode(mode) {
      if (mode === current) return;
      current = mode;
      if (mode !== 'contact') contactState = 'prompt';
      refresh();
      render();
    },
    move(delta) {
      const key = listKey();
      if (!key || (key === 'contact' && contactState !== 'verified')) return false;
      const next = Math.max(0, Math.min(listLen() - 1, index[key] + delta));
      if (next === index[key]) return false;
      index[key] = next;
      render();
      selectCb(next);
      return true;
    },
    selectedIndex: () => {
      const key = listKey();
      return key ? index[key] : 0;
    },
    select(i) {
      const key = listKey();
      if (!key) return;
      index[key] = Math.max(0, Math.min(listLen() - 1, i));
      render();
    },
    confirm,
    setContactState(state) {
      if (state === contactState) return;
      contactState = state;
      if (current === 'contact') {
        refresh();
        render();
      }
    },
    onIntent: (cb) => (intentCb = cb),
    onSelect: (cb) => (selectCb = cb),
    flash,
  };
}
