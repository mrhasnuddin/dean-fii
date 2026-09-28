// E-ink screen UI (360 × 480 CSS px), mounted on the wallet display via CSS3DRenderer.
// E-ink doesn't fade: states swap instantly behind a double-invert refresh flash, like real panels.
import './einkScreen.css';
import { emailDisplay, whatsappDisplay, contact } from '../content/contact';

export type ContactScreenState = 'prompt' | 'reading' | 'verified';

export interface EinkScreen {
  el: HTMLElement;
  setState(state: ContactScreenState, flash?: boolean): void;
  flash(): void;
}

const nfcGlyph = `
<svg class="ek-nfc" viewBox="0 0 120 90" aria-hidden="true">
  <rect x="8" y="22" width="44" height="58" rx="6" class="ek-nfc-wallet"/>
  <rect x="62" y="30" width="38" height="38" rx="4" class="ek-nfc-card"/>
  <path class="ek-arc a1" d="M58 40a14 14 0 0 1 0 18"/>
  <path class="ek-arc a2" d="M54 33a24 24 0 0 1 0 32"/>
  <path class="ek-arc a3" d="M50 26a34 34 0 0 1 0 46"/>
</svg>`;

export function createEinkScreen(): EinkScreen {
  const el = document.createElement('div');
  el.className = 'eink';
  el.dataset.state = 'prompt';
  el.innerHTML = `
    <header class="ek-sb"><span>CONTACT</span><span class="ek-bat" aria-hidden="true"></span></header>
    <section class="ek-view" data-view="prompt">
      ${nfcGlyph}
      <p class="ek-title">Contact Dean</p>
      <p class="ek-sub">Press ✓ and Dean’s key will tap in.</p>
    </section>
    <section class="ek-view" data-view="reading">
      <p class="ek-title">Reading key…</p>
      <div class="ek-bar"><i></i></div>
      <p class="ek-sub">Keep it close.</p>
    </section>
    <section class="ek-view" data-view="verified">
      <p class="ek-title">Key verified <span aria-hidden="true">✓</span></p>
      <p class="ek-grp">SEND VIA</p>
      <ul class="ek-list">
        <li class="sel"><span>Email</span><small>${emailDisplay()}</small></li>
        <li><span>WhatsApp</span><small>${whatsappDisplay()}</small></li>
        <li><span>LinkedIn</span><small>${contact.linkedin.label}</small></li>
      </ul>
    </section>
    <footer class="ek-ab"><span>‹ Back</span><span class="ek-pager">—</span><span class="ek-hold">or press ✓</span></footer>`;

  const pager = el.querySelector<HTMLElement>('.ek-pager')!;
  const hold = el.querySelector<HTMLElement>('.ek-hold')!;
  let flashTimer = 0;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const flash = () => {
    // Two quick inversions ≈ an e-ink full refresh. Pure class toggles; no animated properties.
    // Skipped under reduced motion: a full-panel invert flicker is exactly what that setting avoids.
    if (reduce.matches) return;
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

  return {
    el,
    flash,
    setState(state, withFlash = true) {
      if (withFlash) flash();
      el.dataset.state = state;
      pager.textContent = state === 'verified' ? '1 of 3' : '—';
      hold.textContent = state === 'verified' ? 'Hold ✓' : state === 'prompt' ? 'or press ✓' : '…';
    },
  };
}
