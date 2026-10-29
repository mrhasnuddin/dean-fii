// The two symbols of the story figures (docs/device-design.md §56), drawn as strokes, not text: a big question mark painted across a
// face of the Problem cube (like the question blocks in a platform game), and a light bulb with five rays that lights on the Idea
// laptop's screen. Both are centred on (0, 0) in their own units. Plain ESM.

/** The question mark painted on a cube face, in world units: the face is 81 across (three cubies), the mark about 72 tall. */
export const QUESTION_STROKE = 'M-17 -17C-17 -38 21 -38 21 -13C21 3 1 6 1 23';
export const QUESTION_DOT = { x: 1, y: 40, r: 6.6 };

const rays = Array.from({ length: 5 }, (_, i) => {
  const a = ((-90 + (i - 2) * 38) * Math.PI) / 180;
  const f = (v) => Math.round(v * 10) / 10;
  return `M${f(Math.cos(a) * 19.5)} ${f(-3 + Math.sin(a) * 19.5)}L${f(Math.cos(a) * 23.6)} ${f(-3 + Math.sin(a) * 23.6)}`;
}).join('');

/** The bulb for the laptop's screen: the glass, its base and filament, and the rays (`data-part="rays"`, which the page flickers). */
export function bulbSvg() {
  return `<g transform="scale(1.4)"><g transform="translate(0 2) scale(0.86)"><path class="gl-s" d="M0 -15.5C-6.2 -15.5 -10.2 -11 -10.2 -5.8C-10.2 -2 -8 0.4 -6.2 2.4C-5.2 3.6 -4.8 4.6 -4.8 6.4H4.8C4.8 4.6 5.2 3.6 6.2 2.4C8 0.4 10.2 -2 10.2 -5.8C10.2 -11 6.2 -15.5 0 -15.5Z"/><path class="gl-s" d="M-3.6 10.4H3.6M-2.2 13.6H2.2"/><path class="gl-s2" d="M-3.2 -3.4L0 0.8L3.2 -3.4M0 0.8V6.4"/></g><g data-part="rays"><path class="gl-s2" d="${rays}"/></g></g>`;
}
