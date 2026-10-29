// The frame loop the story figures share (docs/device-design.md §56): it runs only while the figure is on
// screen and Motion is on, draws one still frame otherwise, and keeps its update rate to what the page can bear. A figure gives it
// a length (one loop, in seconds), the moment its still frame shows, and a draw(t) that paints the figure at loop time t.
import { motion } from '../../motion';

export interface LoopOptions {
  /** The element whose visibility starts and stops the loop. */
  stage: Element;
  /** Seconds in one loop. */
  length: number;
  /** The moment of the loop the still frame shows (before the figure is on screen, and for good when Motion is off). */
  poster: number;
  /** Paints the figure at loop time `t`; `clock` runs on without wrapping (for ambient motion); `calm` is Motion off. */
  draw(t: number, clock: number, calm: boolean): void;
  /** Called when a loop ends, before the next one starts. */
  onWrap?(): void;
}
export interface Loop {
  /** Freezes the figure at loop time t for good (for the lab and the checks). */
  seek(t: number): void;
  /** For a figure that answers the pointer: starts the loop again if it had stopped (Motion off draws one frame instead). */
  wake(): void;
  destroy(): void;
}

export function driveLoop(o: LoopOptions): Loop {
  let t = o.poster;
  let clock = 0, last = 0, frame = 0, visible = false, started = false, frozen = false;
  // Every update costs the whole page a fixed amount (paint, layers, commit), however little changed, so how often a figure updates
  // is what matters: at most about 65 a second, and about 30 for good when the page cannot keep that up (the updates average more
  // than 26 ms apart). The motion follows time, not frames, so it only gets coarser.
  let gap = 16, updates = 0, coarse = false;

  function tick(now: number) {
    if (last && now - last < (coarse ? 30 : 15)) {
      frame = requestAnimationFrame(tick);
      return;
    }
    if (last && now - last < 100 && !coarse && !frozen) {
      gap += (now - last - gap) * 0.08;
      if (++updates > 40 && gap > 26) coarse = true;
    }
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
    last = now;
    const calm = motion.reduced();
    if (!calm && !frozen) {
      clock += dt;
      t += dt;
      if (t >= o.length) {
        o.onWrap?.();
        t -= o.length;
      }
    }
    o.draw(t, clock, calm);
    frame = visible && !calm && !frozen ? requestAnimationFrame(tick) : 0;
  }
  const run = () => {
    if (!frame && visible && !motion.reduced() && !frozen) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (!visible) return;
      if (!started && !motion.reduced()) {
        started = true;
        t = 0; // the poster gives way to the loop
      }
      run();
    },
    { rootMargin: '120px 0px' },
  );
  io.observe(o.stage);
  const off = motion.subscribe((reduced) => {
    if (reduced) {
      cancelAnimationFrame(frame);
      frame = 0;
      t = o.poster;
      o.draw(t, clock, true);
    } else run();
  });

  o.draw(t, 0, true); // the poster

  return {
    seek(time) {
      cancelAnimationFrame(frame);
      frame = 0;
      frozen = true;
      started = true;
      t = time;
      o.draw(t, clock, true);
    },
    wake() {
      if (motion.reduced() || frozen) {
        o.draw(t, clock, true);
        return;
      }
      started = true;
      run();
    },
    destroy() {
      cancelAnimationFrame(frame);
      io.disconnect();
      off();
    },
  };
}
