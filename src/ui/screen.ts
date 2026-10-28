// The wallet's e-ink screen for the whole site (360 × 480 CSS px, mounted with CSS3DRenderer).
// One mode per section. The roller moves the selection (partial refresh: instant, no flash); a mode
// change does a full refresh flash, like a real e-ink panel. `confirm()` returns what ✓ should do.
// Idle: the Hello screen is the pixel D-star; any other screen falls back to it after IDLE_MS with
// no input anywhere, and wakes on the next pointer move, key, wheel, scroll or touch.
// Works has two pages: SELECTED (the five best projects, then a "View more…" row) and ARCHIVE (the rest,
// shown once the archive cartridge is docked in the bottom bay). The status strip names both; main.ts flips them
// and docks the cartridge first, so the screen only loads the archive after it is in (docs/works-cartridge-blueprint.md).
// The battery icon in the status strip follows the device's battery (scene/power.ts).
import './einkScreen.css';
import './screen.css';
import { FLAG_SVG as FLAG, LOGO_PATHS } from '../brand/logo';
import { createPixelLogo } from './pixelLogo';
import { contact, emailDisplay, whatsappDisplay } from '../content/contact';
import { archiveWorks, countries, events, profile, selectedWorks, toolNames, type Project } from '../content/portfolio';
import { motion } from '../motion';

export type ScreenMode = 'boot' | 'hello' | 'works' | 'chronicle' | 'about' | 'contact';
export type ContactState = 'prompt' | 'reading' | 'verified';
export type WorksPage = 'selected' | 'archive';
export type ScreenIntent =
  | { type: 'project'; id: string }
  | { type: 'event'; id: string }
  | { type: 'about' }
  | { type: 'contact' }
  | { type: 'channel'; channel: 'email' | 'whatsapp' | 'linkedin' }
  | { type: 'tab'; tab: 'works' | 'chronicle' | 'about' | 'contact' }
  /** SELECTED or ARCHIVE was tapped in Works' status strip, or the "View more…" row was opened. */
  | { type: 'page'; page: WorksPage }
  /** A label on the bottom edge was tapped: press that face key, or (Contact, Email selected) copy the address. */
  | { type: 'key'; key: 'back' | 'confirm' | 'copy' }
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
  /** Feedback for a copy of the email address: the footer's middle says so for a moment. */
  copied(ok: boolean): void;
  /** Works' page: the selected projects, or the archive. Leaving Works goes back to SELECTED. */
  worksPage(): WorksPage;
  /** `instant`: no "Reading cartridge…" interlude before the archive's rows (a deep link, where the cartridge is simply in). */
  setWorksPage(page: WorksPage, instant?: boolean): void;
  onPage(cb: (page: WorksPage) => void): void;
  /** The device's battery, for the status strip's icon: level 0–1, and whether it is charging. */
  setBattery(level: number, charging: boolean): void;
  /** A line over the bottom of the screen for a moment (the volume knob's level). */
  toast(text: string): void;
  /** Row click/tap on the screen: select, or confirm if already selected. */
  onIntent(cb: (intent: ScreenIntent) => void): void;
  onSelect(cb: (index: number) => void): void;
  flash(): void;
}

const LABEL: Record<ScreenMode, string> = {
  boot: 'DEAN STUDIO', hello: 'HELLO', works: 'WORKS', chronicle: 'EVENTS', about: 'ABOUT', contact: 'CONTACT',
};
const CHANNELS = [
  { id: 'email', name: 'Email', detail: emailDisplay() },
  { id: 'whatsapp', name: 'WhatsApp', detail: whatsappDisplay() },
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
// Dean's local time, 24-hour, in the status bar like a phone's: Malaysia (GMT+8, no daylight saving).
const LOCAL_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clockNow = () => LOCAL_TIME.format(new Date());
const battery = { level: 0.62, charging: true }; // the device's battery (setBattery); drawn in every status strip
const batteryHtml = () => `<span class="ek-bat" aria-hidden="true" style="--lv:${battery.level.toFixed(2)}"${battery.charging ? ' data-charging' : ''}></span>`;
const statusRight = () => `<span class="ek-sb-r"><span class="ek-clock"><b>${clockNow()}</b> GMT+8</span>${batteryHtml()}</span>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// The archive cartridge, drawn for the "View more…" row's picture: the same shape as the one on the device (a label
// on the face, contacts on the end that goes in).
const cartridgeGlyph = `
<svg class="sc-cart" viewBox="0 0 100 100" aria-hidden="true">
  <rect class="sc-cart-body" x="22" y="8" width="56" height="84" rx="8"/>
  ${Array.from({ length: 5 }, (_, k) => `<rect class="sc-cart-ink" x="${30 + k * 9.6}" y="13" width="5.4" height="7" rx="1"/>`).join('')}
  <rect class="sc-cart-ink" x="30" y="34" width="40" height="32" rx="3"/>
  <path class="sc-cart-paper" d="M36 44h28M36 51h28M36 58h18"/>
  <path class="sc-cart-body" d="M30 78h40M30 83h40"/>
</svg>`;
// Card reader glyph: the wallet in profile with the key half inserted in its side slot; the arrow
// blinks in e-ink steps.
const readerGlyph = `
<svg class="ek-nfc" viewBox="0 0 120 90" aria-hidden="true">
  <rect x="10" y="6" width="46" height="78" rx="7" class="ek-nfc-wallet"/>
  <rect x="44" y="38" width="58" height="22" rx="3" class="ek-nfc-card"/>
  <path class="ek-arc a1" d="M114 49h-8m0 0 5-5m-5 5 5 5"/>
</svg>`;

// Works' selected page ends with a row that is not a project: opening it docks the archive cartridge.
const GHOST = { ghost: true } as const;
type Row = Project | typeof GHOST;
const isGhost = (r: Row): r is typeof GHOST => 'ghost' in r;
const SELECTED_ROWS: Row[] = [...selectedWorks, GHOST];
const PAGES: WorksPage[] = ['selected', 'archive'];
const PAGE_LABEL: Record<WorksPage, string> = { selected: 'SELECTED', archive: 'ARCHIVE' };
/** "Reading cartridge…" shows this long, once the cartridge has seated, before the archive's rows are drawn. */
const READ_MS = 520;

export function createScreen(): Screen {
  const el = document.createElement('div');
  el.className = 'eink screen';
  let current: ScreenMode = 'boot';
  let contactState: ContactState = 'prompt';
  const logo = createPixelLogo();
  const saver = document.createElement('div');
  saver.className = 'sc-saver';
  saver.hidden = true;
  // Standby (lock screen): the status bar with the clock, then the idle mark.
  saver.innerHTML = `<header class="ek-sb"><span>Standby</span>${statusRight()}</header>
    <section class="ek-view sc-home"><div class="sc-mark"></div><p class="sc-caption">Dean Studio</p></section>`;
  const index: Record<'works' | 'archive' | 'chronicle' | 'contact', number> = { works: 0, archive: 0, chronicle: 0, contact: 0 };
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
  // Full refresh (mode or contact state change): the double flash. Silent: the press that caused it
  // already sounded.
  const refresh = () => flash();

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

  const worksList = (): readonly Row[] => (worksPage === 'archive' ? archiveWorks : SELECTED_ROWS);
  const worksKey = () => (worksPage === 'archive' ? 'archive' : 'works');
  // While the archive is being read (the cartridge has just seated) there is no list to move in.
  const listLen = () => (reading ? 0 : current === 'works' ? worksList().length : current === 'chronicle' ? events.length : current === 'contact' ? CHANNELS.length : 0);
  const listKey = () => (reading ? null : current === 'works' ? worksKey() : current === 'chronicle' || current === 'contact' ? current : null);

  function windowed<T>(items: readonly T[], sel: number): { item: T; i: number }[] {
    const rows = visibleRows();
    const start = Math.max(0, Math.min(sel - Math.floor(rows / 2), items.length - rows));
    return items.slice(start, start + rows).map((item, k) => ({ item, i: start + k }));
  }

  // The top of every screen: the four softkeys right under the wallet's tab keys (01–04; the active one is
  // inverted, with a caret up to its key), then a status strip: the page name on the left, the local
  // clock and the battery on the right (Hello shows them too).
  function softkeys() {
    const keys = SOFTKEYS.map(({ tab, x }, i) => {
      const on = tab === current;
      return `<span data-softkey="${tab}" class="${on ? 'on' : ''}" style="left:${(180 + x * PX_PER_W).toFixed(1)}px">0${i + 1}</span>`;
    }).join('');
    // Works names its two pages after its own name; the one showing is inverted, and both can be tapped.
    const name =
      current === 'works'
        ? `<span class="ek-pages">WORKS ${PAGES.map((p) => `<span data-page="${p}" class="${p === worksPage ? 'on' : ''}">${PAGE_LABEL[p]}</span>`).join('')}</span>`
        : `<span>${LABEL[current]}</span>`;
    return `<header class="ek-sb ek-soft">${keys}</header><header class="ek-sb ek-status">${name}${statusRight()}</header>`;
  }

  // Bottom edge: labels for the two face keys under it (‹ Back, ✓). They are tappable too: on a phone the
  // label is the bigger target, and it is what people try first.
  function footer(left: string, mid: string, right: string, midKey?: 'copy') {
    const ok = right === '…' || right === '—' ? '' : ' data-key="confirm"';
    const m = midKey ? ` data-key="${midKey}" class="ek-act"` : '';
    return `<footer class="ek-ab"><span data-key="back">${left}</span><span${m}>${mid}</span><span class="ek-hold"${ok}>${right}</span></footer>`;
  }
  const toastEl = document.createElement('p');
  toastEl.className = 'sc-toast';
  toastEl.setAttribute('aria-hidden', 'true');
  let toastTimer = 0;
  let worksPage: WorksPage = 'selected';
  let pageCb: (page: WorksPage) => void = () => {};
  // The archive cartridge has just seated: "Reading cartridge…" for a moment, then the rows.
  let reading = false;
  let readTimer = 0;
  const stopReading = () => {
    clearTimeout(readTimer);
    reading = false;
  };

  // Contact, Email selected: the middle of the footer is a Copy key; after a copy it says how it went.
  let copyNote: string | null = null;
  let copyTimer = 0;

  function render() {
    let html = '';
    switch (current) {
      case 'boot': // under the page loader: a still mark until the wallet arrives
        html = `<section class="ek-view sc-center">
          <svg class="sc-logo" viewBox="0 0 100 100" aria-hidden="true">${LOGO_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>
          <p class="sc-kicker">DEAN STUDIO</p></section>`;
        break;
      case 'hello': // home screen: the pixel D-star idles here (status bar only: no section yet)
        html = `${softkeys()}<section class="ek-view sc-home"><div class="sc-mark"></div><p class="sc-caption">Dean Studio</p></section>
          <footer class="ek-ab"><span data-softkey="works">01 Works</span><span>Scroll ↓</span><span class="ek-hold" data-softkey="contact">04 Contact</span></footer>`;
        break;
      case 'works': {
        if (reading) {
          html = `${softkeys()}<section class="ek-view sc-center sc-reading sc-cartridge"><p class="ek-title">Reading cartridge…</p><div class="ek-bar"><i></i></div><p class="ek-sub">Archive · ${archiveWorks.length} projects</p></section>
            ${footer('‹ Eject', '—', '…')}`;
          break;
        }
        const list = worksList();
        const sel = index[worksKey()];
        const row = list[sel];
        // The projects are counted without the "View more…" row that ends the selected page.
        const count = worksPage === 'archive' ? archiveWorks.length : selectedWorks.length;
        const well = isGhost(row)
          ? `<figure class="sc-well sc-well-cart">${cartridgeGlyph}<figcaption>ARCHIVE · ${archiveWorks.length} MORE</figcaption></figure>`
          : `<figure class="sc-well"><img src="${row.eink}" alt="" draggable="false"><figcaption>${esc(row.category)}</figcaption></figure>`;
        const rowHtml = ({ item, i }: { item: Row; i: number }) =>
          isGhost(item)
            ? `<li data-index="${i}" class="sc-ghost${i === sel ? ' sel' : ''}"><span>View more…</span><small>${archiveWorks.length} projects</small></li>`
            : `<li data-index="${i}" class="${i === sel ? 'sel' : ''}"><span>${esc(item.title)}${item.flagship ? `${FLAG}<span class="sr"> Flagship</span>` : ''}</span><small>${esc(item.tags[0])}</small></li>`;
        html = `${softkeys()}
          <section class="ek-view sc-list">
            ${well}
            <ul class="ek-list sc-rows">${windowed(list, sel).map(rowHtml).join('')}</ul></section>
          ${worksPage === 'archive' ? footer('‹ Eject', `${sel + 1} of ${count}`, 'Open ✓') : isGhost(row) ? footer('‹ Back', 'Archive', 'View ✓') : footer('‹ Back', `${sel + 1} of ${count}`, 'Open ✓')}`;
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
          html = `${softkeys()}<section class="ek-view sc-center sc-reading"><p class="ek-title">Reading key…</p><div class="ek-bar"><i></i></div><p class="ek-sub">Keep the key in.</p></section>
            ${footer('‹ Back', '—', '…')}`;
        } else {
          const sel = index.contact;
          html = `${softkeys()}<section class="ek-view sc-list"><p class="ek-title">Key read <span aria-hidden="true">✓</span></p><p class="ek-grp">SEND VIA</p>
            <ul class="ek-list">${CHANNELS.map((c, i) => `<li data-index="${i}" class="${i === sel ? 'sel' : ''}"><span>${c.name}</span><small>${esc(c.detail)}</small></li>`).join('')}</ul></section>
            ${CHANNELS[sel].id === 'email' ? footer('‹ Back', copyNote ?? 'Copy ⧉', 'Open ✓', copyNote ? undefined : 'copy') : footer('‹ Back', `${sel + 1} of 3`, 'Open ✓')}`;
        }
        break;
    }
    el.dataset.mode = current;
    el.innerHTML = html;
    el.append(saver, toastEl);
    mountLogo();
    if ((current === 'contact' && contactState === 'reading') || reading) {
      // Start the stepped bar on the next frame so the clip-path transition runs from empty.
      requestAnimationFrame(() => el.querySelector('.sc-reading')?.classList.add('go'));
    }
  }

  function confirm(): ScreenIntent {
    switch (current) {
      case 'works': {
        if (reading) return { type: 'none' };
        const row = worksList()[index[worksKey()]];
        return isGhost(row) ? { type: 'page', page: 'archive' } : { type: 'project', id: row.id };
      }
      case 'chronicle': return { type: 'event', id: events[index.chronicle].id };
      case 'about': return { type: 'about' };
      case 'contact':
        return contactState === 'verified' ? { type: 'channel', channel: CHANNELS[index.contact].id } : contactState === 'prompt' ? { type: 'contact' } : { type: 'none' };
      default: return { type: 'none' };
    }
  }

  el.addEventListener('click', (e) => {
    const page = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
    if (page) return intentCb({ type: 'page', page: page.dataset.page as WorksPage });
    const faceKey = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    if (faceKey) return intentCb({ type: 'key', key: faceKey.dataset.key as 'back' | 'confirm' | 'copy' });
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
  COARSE.addEventListener('change', render);
  // The clock changes in place on the minute, without a refresh flash.
  const tickClock = () => {
    const now = clockNow();
    el.querySelectorAll('.ek-clock b').forEach((b) => (b.textContent = now));
    setTimeout(tickClock, 60_000 - (Date.now() % 60_000) + 50);
  };
  tickClock(); // a hybrid device switching between touch and mouse
  return {
    el,
    mode: () => current,
    setMode(mode) {
      if (mode === current) return;
      current = mode;
      if (mode !== 'contact') contactState = 'prompt';
      if (mode !== 'works' && worksPage !== 'selected') {
        stopReading();
        worksPage = 'selected';
        index.archive = 0;
        pageCb('selected');
      }
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
    copied(ok) {
      copyNote = ok ? 'Copied ✓' : 'Copy failed';
      if (current === 'contact') render();
      clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        copyNote = null;
        if (current === 'contact') render();
      }, 1600);
    },
    setBattery(level, charging) {
      if (Math.abs(level - battery.level) < 0.005 && charging === battery.charging) return;
      battery.level = level;
      battery.charging = charging;
      el.querySelectorAll<HTMLElement>('.ek-bat').forEach((b) => {
        b.style.setProperty('--lv', level.toFixed(2));
        b.toggleAttribute('data-charging', charging);
      });
    },
    toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 1100);
    },
    worksPage: () => worksPage,
    setWorksPage(page, instant = false) {
      if (page === worksPage) return;
      stopReading();
      worksPage = page;
      if (page === 'selected') index.archive = 0; // the next cartridge starts at its first row
      else if (!instant && !motion.reduced()) {
        reading = true;
        readTimer = window.setTimeout(() => {
          reading = false;
          if (current === 'works' && worksPage === 'archive') {
            refresh();
            render();
          }
        }, READ_MS);
      }
      if (current === 'works') {
        refresh();
        render();
      }
      pageCb(page);
    },
    onPage: (cb) => (pageCb = cb),
    onIntent: (cb) => (intentCb = cb),
    onSelect: (cb) => (selectCb = cb),
    flash,
  };
}
