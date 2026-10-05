/**
 * Chain: a design process as a chain of blocks, one block per stage, joined by
 * interlocking links like a keychain's (one link upright, the next flat). The
 * chain lies in a gentle arc from the first idea, far, to the newest block,
 * near, which rests a little raised and lit, as a chain's tip. A block is a
 * stack of thin plates: one for a single pass, two for MVPs or an iteration,
 * three for builds that went v1 to v3. The block under the pointer lifts and
 * its plates fan apart; its neighbours follow less, staggered out from it. A
 * handover ends in a dashed link to the dashed first block of another team's
 * chain; maintenance ends in a dashed link to an empty dashed footprint: the
 * place the next block will take.
 * The flow comes in with mount (the site passes each project's); without one
 * it draws ENI's. The slider is the stagger, in ms.
 */
const { Cam, clamp, facing, fit, poly, prism, proj, ringAt, rings, solid, put, tdone, tset, tval, tween, disposer, mk, pointer, register } = HL;

const ENI = {
  steps: [["Ideation", 1], ["Wireframes", 1], ["MVPs", 2], ["Iteration", 2], ["Builds v1 to v3", 3], ["Iteration", 2], ["Handover", 1]],
  end: "handover",
};
const B = 32, H = 22, PITCH = 64, ARC = 52, R = 4, CR = 1.4; // block side, height, centre to centre, bow of the arc, corner, crease
const PG = 1.6, FAN = 5, LIFT = 14, TIP = 4; // plate gap at rest, extra gap when picked, lift when picked, the tip's rest lift
const FALL = [1, 0.34, 0.1]; // how much the picked block's neighbours follow, by distance; beyond, nothing

/** An oval link: centre c, long axis u (unit, ground), half lengths a and b, upright (in the u–z plane) or flat. */
function oval(P, c, u, a, b, upright) {
  const pts = [];
  for (let k = 0; k < 20; k++) {
    const t = (k / 20) * Math.PI * 2, ca = Math.cos(t) * a, sb = Math.sin(t) * b;
    pts.push(upright ? P(c[0] + u[0] * ca, c[1] + u[1] * ca, c[2] + sb) : P(c[0] + u[0] * ca - u[1] * sb, c[1] + u[1] * ca + u[0] * sb, c[2]));
  }
  return poly(pts);
}

function mount({ stage, svg, read, flow }, value) {
  const bag = disposer();
  const F = flow && flow.steps && flow.steps.length ? flow : ENI;
  const n = F.steps.length, ghost = F.end === "handover", wait = F.end === "maintenance";
  const more = ghost || wait ? 1 : 0; // one place past the last stage: another team's block, or the next block's footprint
  let stag = value;

  // Centres along x, bowed toward the viewer (+y) in the middle, with the place past the last stage when there is one.
  const m = n + more;
  // The bow grows with the chain's length: a short chain lies nearly straight, a long one drapes.
  const bow = ARC * clamp((m - 2) / 5, 0.15, 1);
  const ctr = Array.from({ length: m }, (_, i) => [i * PITCH, bow * Math.sin(Math.PI * (m > 1 ? i / (m - 1) : 0.5))]);
  const plates = F.steps.map((s) => clamp(s[1] | 0, 1, 3));
  const rest = (i) => (i === n - 1 ? TIP : 0);
  const top = (i, t) => rest(i) + t * LIFT + H + (plates[i] - 1) * t * FAN;

  // Scale to the frame: measure the most extreme pose at S 1, then fit it to about 300 × 220.
  const ext = [];
  ctr.forEach(([x, y], i) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
    ext.push([x + (sx * B) / 2, y + (sy * B) / 2, 0], [x + (sx * B) / 2, y + (sy * B) / 2, i < n ? top(i, 1) : H]);
  }));
  const P1 = proj(Cam(45, 0.5, 1)), sp = ext.map((p) => P1(...p));
  const w = Math.max(...sp.map((p) => p[0])) - Math.min(...sp.map((p) => p[0]));
  const h = Math.max(...sp.map((p) => p[1])) - Math.min(...sp.map((p) => p[1]));
  const C = Cam(45, 0.5, clamp(Math.min(300 / w, 220 / h), 0.8, 2.0));
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const foot = ctr.map(([x, y]) => rings(x - B / 2, y - B / 2, x + B / 2, y + B / 2, R, CR));
  const blocks = [], links = [];
  for (let i = 0; i < m; i++) {
    if (i > 0) links.push([mk("path", { class: i < n ? "nf sil" : "nf dash" }, g), mk("path", { class: i < n ? "nf lo" : "nf dash" }, g),
      mk("path", { class: i < n ? "nf sil" : "nf dash" }, g), mk("path", { class: i < n ? "nf lo" : "nf dash" }, g)]);
    if (i >= n) { blocks.push({ ghost: mk("path", { class: "nf dash" }, g) }); continue; }
    const ps = Array.from({ length: plates[i] }, () => solid(g));
    blocks.push({ ps, t: tween(0) });
  }

  /** The ground direction from block i to block j, as a unit vector. */
  const dir = (i, j) => { const dx = ctr[j][0] - ctr[i][0], dy = ctr[j][1] - ctr[i][1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  /** Two interlocking links from block i's face (height za) to block j's face (height zb): upright, then flat. */
  function chainLinks(els, i, j, za, zb) {
    const u = dir(i, j), half = B / 2 + 1, span = PITCH - 2 * half;
    const A = [ctr[i][0] + u[0] * half, ctr[i][1] + u[1] * half], len = span / 2 + 3;
    const c1 = [A[0] + u[0] * (len - 1), A[1] + u[1] * (len - 1), za + (zb - za) * 0.3];
    const c2 = [A[0] + u[0] * (span - len + 1), A[1] + u[1] * (span - len + 1), za + (zb - za) * 0.7];
    els[0].setAttribute("d", oval(P, c1, u, len, 6.5, true));
    els[1].setAttribute("d", oval(P, c1, u, len - 2.4, 4, true));
    els[2].setAttribute("d", oval(P, c2, u, len, 6.5, false));
    els[3].setAttribute("d", oval(P, c2, u, len - 2.4, 4, false));
  }

  const last = new Array(m).fill(-1);
  let lastKey = "";
  function draw(now) {
    let moving = false;
    const lv = blocks.map((bk, i) => (i < n ? tval(bk.t, now) : 0));
    blocks.forEach((bk, i) => {
      if (i >= n) return;
      if (!tdone(bk.t, now)) moving = true;
      if (lv[i] === last[i]) return;
      last[i] = lv[i];
      const k = plates[i], ph = (H - (k - 1) * PG) / k, gap = PG + lv[i] * FAN;
      let z = rest(i) + lv[i] * LIFT;
      bk.ps.forEach((s) => { put(s, prism(P, front, foot[i][0], foot[i][1], z, z + ph)); z += ph + gap; });
    });
    const mid = (i) => (i < n ? rest(i) + lv[i] * LIFT + H / 2 : H / 2);
    const key = lv.join(",");
    if (key === lastKey) return moving; // links and ends follow the blocks: nothing moved, nothing to redraw
    lastKey = key;
    for (let i = 1; i < m; i++) chainLinks(links[i - 1], i - 1, i, mid(i - 1), mid(i));
    if (more) blocks[n].ghost.setAttribute("d", ghost ? prism(P, front, foot[n][0], foot[n][1], 0, H).sil : poly(ringAt(P, foot[n][0], 0)));
    return moving;
  }

  const L = register(stage, (_dt, now) => draw(now));
  bag.add(L.unregister);
  draw(performance.now());

  // Hit test on the REST pose: the block whose resting centre, on screen, is nearest the pointer, within reach.
  const hc = ctr.slice(0, n).map(([x, y], i) => P(x, y, rest(i) + H / 2));
  const reach = Math.hypot(hc[1][0] - hc[0][0], hc[1][1] - hc[0][1]) * 0.8; // most of the way to the next block
  function hit([x, y]) {
    let best = -1, bd = Infinity;
    hc.forEach(([sx, sy], i) => { const d = Math.hypot(x - sx, (y - sy) * 0.8); if (d < bd) { bd = d; best = i; } });
    return bd <= reach ? best : -1;
  }

  let act = -1;
  const mark = (a) => blocks.forEach((bk, i) => i < n && bk.ps.forEach((s) => s.sil.classList.toggle("hi", a < 0 ? i === n - 1 : i === a)));
  /** Picks block a (-1 lets go): it lifts and fans, its neighbours follow less, staggered out from it. */
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    blocks.forEach((bk, i) => {
      if (i >= n) return;
      const d = Math.abs(i - (a >= 0 ? a : i));
      tset(bk.t, a < 0 ? 0 : (FALL[d] ?? 0), now, Math.abs(i - from) * stag);
    });
    mark(a);
    read.textContent = a < 0 ? "rest" : String(a + 1).padStart(2, "0") + " " + F.steps[a][0];
    L.wake();
  }
  mark(-1);
  read.textContent = "rest";

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "chain",
  means: "A process as a chain of blocks: the stage under the pointer lifts and fans its plates, and its neighbours follow.",
  rules: [1, 2, 5, 8],
  range: [0, 45, 90],
  mount,
});
