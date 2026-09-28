// The D-star as e-ink pixels for the wallet screen's idle state. The mark is rasterised to a 1-bit
// 50 × 50 grid (one dot = 3 CSS px) and animated in discrete frames at 10 fps, the way an e-ink
// panel does partial refreshes: no smooth tweening, no grey. Motion matches the page loader: the
// sparkle turns a quarter while it breathes in, throws four glint dots, then rests.
import { D_PATH, STAR_PATH } from '../brand/logo';
import { motion } from '../motion';

const N = 50; // grid dots per side
const DOT = 3; // CSS px per dot
const FPS = 10;
const PERIOD = 3.2; // s per twinkle cycle
const TWINKLE = 0.9; // s of it spent moving; the rest is stillness
const STAR = { x: 80, y: 17 }; // sparkle centre in the logo's 100 × 100 box
const INK = [29, 28, 26]; // --ink

export interface PixelLogo {
  el: HTMLCanvasElement;
  start(): void;
  stop(): void;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function createPixelLogo(): PixelLogo {
  const el = document.createElement('canvas');
  el.width = el.height = N;
  el.className = 'px-logo';
  el.style.width = el.style.height = `${N * DOT}px`;
  el.setAttribute('aria-hidden', 'true');
  const ctx = el.getContext('2d', { willReadFrequently: true })!;
  const d = new Path2D(D_PATH);
  const star = new Path2D(STAR_PATH);

  // Draw one frame of the cycle (u = 0..1 through the twinkle), then snap every dot to ink or paper.
  function draw(u: number) {
    const e = easeInOut(Math.min(1, u));
    const turn = (Math.PI / 2) * e;
    const breathe = 1 - 0.42 * Math.sin(Math.PI * Math.min(1, u)); // 1 → 0.58 → 1
    ctx.clearRect(0, 0, N, N);
    ctx.save();
    ctx.scale(N / 100, N / 100);
    ctx.fillStyle = '#000';
    ctx.fill(d);
    ctx.translate(STAR.x, STAR.y);
    ctx.rotate(turn);
    ctx.scale(breathe, breathe);
    ctx.translate(-STAR.x, -STAR.y);
    ctx.fill(star);
    ctx.restore();
    // Glint: four single dots on the diagonals while the sparkle is at its smallest.
    if (u > 0.3 && u < 0.62) {
      const r = u < 0.46 ? 5 : 7;
      const cx = Math.round((STAR.x / 100) * N);
      const cy = Math.round((STAR.y / 100) * N);
      ctx.fillStyle = '#000';
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ctx.fillRect(cx + sx * r, cy + sy * r, 1, 1);
    }
    const img = ctx.getImageData(0, 0, N, N);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const on = px[i + 3] >= 110;
      px[i] = INK[0];
      px[i + 1] = INK[1];
      px[i + 2] = INK[2];
      px[i + 3] = on ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
  }

  let timer = 0;
  let t0 = 0;
  let lastFrame = -1;
  function tick() {
    const since = (performance.now() - t0) / 1000;
    if (document.hidden || since < 0) return;
    const s = since % PERIOD;
    // Motion switched off mid-loop: hold the resting frame.
    const frame = s < TWINKLE && !motion.reduced() ? Math.floor(s * FPS) : -1; // -1 = resting frame
    if (frame === lastFrame) return;
    lastFrame = frame;
    draw(frame < 0 ? 0 : frame / (TWINKLE * FPS));
  }

  draw(0);
  return {
    el,
    start() {
      if (timer) return;
      lastFrame = -1;
      draw(0);
      t0 = performance.now() + 600; // first twinkle a moment after the screen appears
      timer = window.setInterval(tick, 1000 / FPS);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
      draw(0);
    },
  };
}
