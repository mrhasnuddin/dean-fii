// Contact card face: live HTML, so it can be used flat (popup / list view) or as the CSS3D face of
// the 3D card. All details are real links; email and WhatsApp hrefs are filled in on first intent.
import './contactCard.css';
import { LOGO_PATHS } from '../brand/logo';
import { contact, emailAddress, emailDisplay, mailtoHref, whatsappDisplay, whatsappHref } from '../content/contact';
import { copyText } from './clipboard';
import { sfx } from '../audio/sfx';

const icon = {
  mail: '<path d="M3 6.5h18v11H3z"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10.5V17M8 7.2v.1M12 17v-6.5M12 13.5c0-1.8 1-3 2.6-3 1.5 0 2.4 1 2.4 3V17"/>',
  chat: '<path d="M4.5 19.5 5.6 16A8 8 0 1 1 8 18.4Z"/><path d="M9.2 9.3c.3 2.3 2 4.2 4.3 4.9l1-1.1 1.8.8"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};
const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;

export type ContactCardVariant = 'card' | 'overlay';

/**
 * `card`: the standalone 320 × 320 card (popup / list view).
 * `overlay`: details only, transparent, 288 × 136 px — written onto the 3D key card's label plate.
 */
export function createContactCard(variant: ContactCardVariant = 'card'): HTMLElement {
  const el = document.createElement('article');
  el.className = variant === 'overlay' ? 'contact-card contact-card--overlay' : 'contact-card';
  el.setAttribute('aria-label', `${contact.name}, ${contact.studio}: contact details`);
  const decorations = variant === 'overlay' ? '' : `
    <span class="cc-corner cc-tl"></span><span class="cc-corner cc-tr"></span>
    <span class="cc-corner cc-bl"></span><span class="cc-corner cc-br"></span>
    <svg class="cc-logo" viewBox="0 0 100 100" aria-hidden="true">${LOGO_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>
    <svg class="cc-stars" viewBox="0 0 120 40" aria-hidden="true">
      <path d="M4 30 30 12 54 22 82 8 112 26"/>
      <circle cx="4" cy="30" r="1.6"/><circle cx="30" cy="12" r="1.6"/><circle cx="54" cy="22" r="1.6"/>
      <circle cx="82" cy="8" r="1.6"/><circle cx="112" cy="26" r="1.6"/>
    </svg>`;
  el.innerHTML = `${decorations}
    <div class="cc-id">
      <p class="cc-name cc-write" style="--i:0">${contact.name}</p>
      <p class="cc-studio cc-write" style="--i:1">${contact.studio}</p>
    </div>
    <ul class="cc-links">
      <li class="cc-write" style="--i:2">
        <a class="cc-link" data-href="mailto" href="#contact">
          ${svg(icon.mail)}<span><span class="cc-sr">Email: </span>${emailDisplay()}</span>
        </a>
        <button class="cc-copy" type="button" aria-label="Copy email address">${svg(icon.copy)}</button>
      </li>
      <li class="cc-write" style="--i:3">
        <a class="cc-link" href="${contact.linkedin.url}" target="_blank" rel="noopener noreferrer">
          ${svg(icon.linkedin)}<span><span class="cc-sr">LinkedIn: </span>${contact.linkedin.label}<span class="cc-sr"> (opens in a new tab)</span></span>
        </a>
      </li>
      <li class="cc-write" style="--i:4">
        <a class="cc-link" data-href="whatsapp" href="#contact" target="_blank" rel="noopener noreferrer">
          ${svg(icon.chat)}<span><span class="cc-sr">WhatsApp: </span>${whatsappDisplay()}<span class="cc-sr"> (opens in a new tab)</span></span>
        </a>
      </li>
    </ul>
    <p class="cc-status" role="status" aria-live="polite"></p>`;

  // Fill real hrefs on first intent (hover, focus, touch): full values stay out of the static HTML.
  const resolve: Record<string, () => string> = { mailto: mailtoHref, whatsapp: whatsappHref };
  el.querySelectorAll<HTMLAnchorElement>('a[data-href]').forEach((a) => {
    const fill = () => {
      const make = resolve[a.dataset.href!];
      if (make) a.href = make();
      a.removeAttribute('data-href');
    };
    for (const ev of ['pointerenter', 'pointerdown', 'focus', 'touchstart'] as const) {
      a.addEventListener(ev, fill, { once: true, passive: true });
    }
  });

  const copyBtn = el.querySelector<HTMLButtonElement>('.cc-copy')!;
  const status = el.querySelector<HTMLElement>('.cc-status')!;
  let timer = 0;
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(emailAddress());
    sfx.play(ok ? 'detent' : 'toggle', ok ? {} : { rate: 0.8 });
    copyBtn.innerHTML = svg(ok ? icon.check : icon.copy);
    copyBtn.dataset.state = ok ? 'done' : 'fail';
    status.textContent = ok ? 'Email copied' : 'Couldn’t copy. Use the email link instead.';
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      copyBtn.innerHTML = svg(icon.copy);
      delete copyBtn.dataset.state;
      status.textContent = '';
    }, 1800);
  });

  return el;
}

/**
 * Written state for the overlay variant: lines appear one by one (90 ms apart) as if written onto the
 * card. `false` hides them again (for replays). Reduced motion gets a plain fade (see CSS).
 */
export function setContactCardWritten(el: HTMLElement, written: boolean): void {
  if (written) el.dataset.written = '';
  else delete el.dataset.written;
  el.inert = !written; // unwritten lines are neither focusable nor announced
}
