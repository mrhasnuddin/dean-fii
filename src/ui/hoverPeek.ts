// Events list, hover image: a thumbnail of the event follows the pointer while it is over a row (docs §51).
// Mouse and pen only, touch has no hover. One fixed frame holds an <img> per event, all fetched once the list nears
// the screen and cross-faded as the pointer moves between rows. The frame trails the pointer by easing its transform
// on rAF (transform and opacity only), and the loop sleeps whenever the frame has caught up. With motion reduced it
// sits on the pointer and only fades; keyboard focus shows the picture with no animation at all.
import { motion } from '../motion';

const GAP = 28; // between the pointer and the frame
const EDGE = 12; // how close the frame may come to the viewport edge

export function mountHoverPeek(root: HTMLElement, rows: HTMLElement, src: (id: string) => string): void {
  const frame = document.createElement('div');
  frame.className = 'lv-peek';
  frame.setAttribute('aria-hidden', 'true');
  frame.innerHTML = '<div class="lv-peek-card"></div>';
  const card = frame.firstElementChild as HTMLElement;
  root.append(frame);

  const imgs = new Map<string, HTMLImageElement>();
  const load = (id: string) => {
    let img = imgs.get(id);
    if (!img) {
      img = new Image();
      img.alt = '';
      img.decoding = 'async';
      const own = img;
      img.addEventListener('load', () => own.classList.add('ready'));
      img.src = src(id);
      card.append(img);
      imgs.set(id, img);
    }
    return img;
  };
  // Fetch every thumbnail (about 30 KB each) once the list is near the screen, so the first hover is already instant.
  new IntersectionObserver(
    (entries, io) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      rows.querySelectorAll<HTMLElement>('[data-peek]').forEach((a) => load(a.dataset.peek!));
    },
    { rootMargin: '400px' },
  ).observe(rows);

  let w = 0;
  let h = 0;
  let px = 0; // pointer
  let py = 0;
  let x = 0; // the frame's top-left, eased toward its target
  let y = 0;
  let side = '';
  let active = '';
  let on = false;
  let snap = false;
  let scrolled = false;
  let raf = 0;
  let last = 0;

  const measure = () => {
    w = frame.offsetWidth;
    h = frame.offsetHeight;
  };
  /** Beside the pointer, vertically centred on it; on the left when the right side would run off the screen. */
  const place = () => {
    const left = px + GAP + w > innerWidth - EDGE && px - GAP - w >= EDGE;
    const nextSide = left ? 'left' : 'right';
    if (nextSide !== side) frame.dataset.side = side = nextSide;
    const tx = Math.min(Math.max(left ? px - GAP - w : px + GAP, EDGE), innerWidth - w - EDGE);
    const ty = Math.min(Math.max(py - h / 2, EDGE), innerHeight - h - EDGE);
    return [tx, ty] as const;
  };
  const rowAt = (el: Element | null) => el?.closest<HTMLElement>('[data-peek]')?.dataset.peek;

  const step = (now: number) => {
    raf = -1; // running: wake() must not queue a second frame from inside this one
    if (root.hidden) return hide();
    if (scrolled) {
      // The page scrolled under a still pointer: whichever row arrived under it takes over (once per frame, not per scroll event).
      scrolled = false;
      const id = rowAt(document.elementFromPoint(px, py));
      if (!id) return hide();
      if (id !== active) show(id);
    }
    const dt = Math.min(now - last, 64);
    last = now;
    const [tx, ty] = place();
    if (snap || motion.reduced()) {
      x = tx;
      y = ty;
      snap = false;
    } else {
      const k = 1 - Math.exp(-dt / 80);
      x += (tx - x) * k;
      y += (ty - y) * k;
    }
    // The frame leans into the move: a little tilt for as long as it lags the pointer.
    const settled = Math.abs(tx - x) < 0.2 && Math.abs(ty - y) < 0.2;
    if (settled) {
      x = tx;
      y = ty;
    }
    const tilt = settled || motion.reduced() ? 0 : Math.max(-6, Math.min(6, (tx - x) * 0.06));
    frame.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${tilt.toFixed(2)}deg)`;
    raf = settled ? 0 : requestAnimationFrame(step); // caught up: sleep until the pointer or the page moves again
  };
  const wake = () => {
    if (!on || raf) return;
    last = performance.now();
    raf = requestAnimationFrame(step);
  };

  function hide() {
    on = false;
    cancelAnimationFrame(raf);
    raf = 0;
    frame.classList.remove('on');
  }
  const show = (id: string, viaKeyboard = false) => {
    if (active && active !== id) imgs.get(active)?.classList.remove('is-on');
    load(id).classList.add('is-on');
    active = id;
    frame.classList.toggle('kb', viaKeyboard);
    if (on) return wake();
    measure();
    frame.classList.toggle('calm', motion.reduced());
    snap = true; // appear on the pointer, not gliding in from wherever it last was
    on = true;
    frame.classList.add('on');
    wake();
  };

  rows.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    px = e.clientX;
    py = e.clientY;
    const id = rowAt(e.target as Element);
    if (id && (id !== active || !on)) show(id);
    else wake();
  });
  rows.addEventListener('pointerleave', hide);
  rows.addEventListener('click', hide);
  addEventListener(
    'scroll',
    () => {
      if (!on) return;
      scrolled = true;
      wake();
    },
    { passive: true },
  );
  // Keyboard focus gets the same picture, set beside the row and shown without any motion; Escape puts it away.
  rows.addEventListener('focusin', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-peek]');
    if (!a || !a.matches(':focus-visible')) return;
    const r = a.getBoundingClientRect();
    px = r.left + r.width * 0.5;
    py = r.top + r.height / 2;
    show(a.dataset.peek!, true);
  });
  rows.addEventListener('focusout', hide);
  rows.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  addEventListener('resize', () => on && measure());
  addEventListener('blur', hide);
  motion.subscribe((reduced) => frame.classList.toggle('calm', reduced));
}
