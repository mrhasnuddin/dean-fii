// The AI-native workflow as moves on a Rubik's cube (docs/device-design.md §32). Each step of Dean's workflow
// is one quarter turn, and Framework's four sub-steps are four, so nine moves solve the cube: the figure
// starts from the scramble those nine moves undo. Pure data and maths, shared by the page and the audit.

/** The steps as the handheld's screen shows them: a short title and a short status line. */
export const STEPS = [
  { title: "BRIEF", line: "CLIENT INPUT", moves: 1 },
  { title: "IDEATION", line: "REFERENCES", moves: 1 },
  { title: "FRAMEWORK", line: "", moves: 4, subs: ["SKILLS", "TOKENS", "MOTION", "PROMPT"] },
  { title: "PROTOTYPE", line: "LOCALHOST", moves: 1 },
  { title: "ITERATION", line: "REFINE", moves: 1 },
  { title: "SHIP", line: "DEPLOYED", moves: 1 },
];

/** The nine moves, in order: [axis, quarter turns]. Each turns the outer layer on the +axis side (U, R, F). */
export const MOVES = [
  ["x", -1], ["z", -1], ["y", 1], ["z", 1], ["x", 1], ["y", -1], ["z", -1], ["x", -1], ["z", 1],
];
export const MOVE_COUNT = MOVES.length;

/** Which step and sub-step a count of moves made belongs to: the step whose last move it is. */
export function stepOf(made) {
  let end = 0;
  for (let i = 0; i < STEPS.length; i++) {
    const start = end;
    end += STEPS[i].moves;
    if (made <= end) return { step: i, sub: Math.max(0, made - start - 1), start, end };
  }
  return { step: STEPS.length - 1, sub: 0, start: end - 1, end };
}
/** Moves made once step i is done. */
export const endOf = (i) => STEPS.slice(0, i + 1).reduce((n, s) => n + s.moves, 0);

// Faces: +x is R, +y is F, +z is U, and their opposites L, B, D. Each holds a sticker colour index.
export const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const FACE_COLOUR = [1, 4, 2, 5, 0, 3]; // R paper, L bronze, F steel, B slate, U champagne, D graphite
const AXIS = { x: 0, y: 1, z: 2 };

/** A quarter-turn rotation about an axis, as a 3 × 3 integer matrix (right-handed, q quarter turns). */
export function rotation(axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  if (axis === "x") return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === "y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
export const apply = (m, v) => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);
const mul = (a, b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
const snap = (m) => m.map((row) => row.map((x) => Math.round(x)));
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** The 27 cubies, solved: each at its home position with stickers on its outer faces. */
export function solved() {
  const cubies = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const home = [x, y, z];
    const stickers = FACES.map((n, f) => (n.some((v, a) => v !== 0 && v === home[a]) ? FACE_COLOUR[f] : -1));
    cubies.push({ id: cubies.length, home, pos: home.slice(), rot: I.map((r) => r.slice()), stickers });
  }
  return cubies;
}

/** Turns one layer a whole quarter: positions and orientations of the cubies on the +axis side. */
export function turn(cubies, [axis, q]) {
  const m = rotation(axis, (q * Math.PI) / 2);
  for (const c of cubies) {
    if (c.pos[AXIS[axis]] !== 1) continue;
    c.pos = apply(m, c.pos).map(Math.round);
    c.rot = snap(mul(m, c.rot));
  }
}
export const inLayer = (cubie, axis) => cubie.pos[AXIS[axis]] === 1;

/** The cube after `made` moves of the solution, from the scramble. */
export function cubeAt(made) {
  const cubies = solved();
  for (let i = MOVES.length - 1; i >= 0; i--) turn(cubies, [MOVES[i][0], -MOVES[i][1]]);
  for (let i = 0; i < made; i++) turn(cubies, MOVES[i]);
  return cubies;
}

/** The world direction a cubie's sticker (its local face f) faces. */
export const facing = (cubie, f) => apply(cubie.rot, FACES[f]).map(Math.round);

/**
 * The stickers on the face a move just turned (its +axis face) that will still face the viewer (U, R or F)
 * once the cube is solved, so a mark put there now is on show at the end. `made` moves are done.
 */
export function markable(cubies, made, taken = new Set()) {
  const [axis] = MOVES[made - 1];
  const out = FACES.findIndex((n) => n[AXIS[axis]] === 1);
  const seen = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const found = [];
  for (const c of cubies) {
    if (taken.has(c.id) || c.pos[AXIS[axis]] !== 1) continue;
    const f = c.stickers.findIndex((colour, i) => colour >= 0 && facing(c, i).every((v, a) => v === FACES[out][a]));
    if (f < 0) continue;
    // follow this cubie through the moves still to come
    const ghost = { pos: c.pos.slice(), rot: c.rot.map((r) => r.slice()) };
    for (let m = made; m < MOVES.length; m++) turn([ghost], MOVES[m]);
    const end = apply(ghost.rot, FACES[f]).map(Math.round);
    if (seen.some((n) => n.every((v, a) => v === end[a]))) found.push({ id: c.id, f });
  }
  return found;
}

/** Whether every outer face shows one colour (true only after the last move). */
export function isSolved(cubies) {
  return FACES.every((n, f) => {
    const seen = new Set();
    for (const c of cubies) {
      if (!c.pos.every((v, a) => n[a] === 0 || v === n[a])) continue;
      // the sticker facing n: the local face whose rotated normal is n
      const local = FACES.findIndex((m) => apply(c.rot, m).every((v, a) => Math.round(v) === n[a]));
      seen.add(c.stickers[local]);
    }
    return seen.size === 1;
  });
}
