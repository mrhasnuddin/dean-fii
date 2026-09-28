// D-star coin keychain: lanyard bar (on the device) → 2 cable links → jump ring → coin (bail + body).
//
// Geometry and physics share one contact model so the parts interlock without intersecting:
// consecutive elements touch at a node. The lower element's wire sits `t` above the node and the
// upper element's wire sits `t` below it. Neighbouring elements are turned 90° about the chain axis,
// so every wire passes through the next element's opening. All sizes are in W (device body width).
import * as THREE from 'three';
import { coinFaceMaps, reedingMap } from './coinTextures';

// A small charm, secondary to the wallet: the coin is the size of the ✓ key (Ø 0.17 W ≈ 9 mm at
// device scale; was 0.48 W, then 0.28 W), and every part of the chain is scaled with it.
export const KC = {
  barRadius: 0.006,
  // 2 links: an even count keeps the coin facing front (neighbours alternate 90°, interlock rule).
  link: { count: 2, t: 0.005, r: 0.018, L: 0.042 }, // inner width 2(r−t) = 0.026 > any wire it carries
  jump: { R: 0.021, t: 0.005 },
  bail: { R: 0.017, t: 0.005 },
  coin: { R: 0.085, rim: 0.012, h: 0.012, field: 0.008, edge: 0.004 },
} as const;

const LINK_S = KC.link.L + 2 * KC.link.t - 2 * KC.link.r; // straight length of each link
const JUMP_L = 2 * KC.jump.R - 2 * KC.jump.t;
const COIN_D = 2 * KC.bail.R - KC.bail.t + KC.coin.R; // bail contact → coin centre

/** Closed stadium (cable-chain link) centreline in the XY plane; top apex at y = `top`. */
class StadiumCurve extends THREE.Curve<THREE.Vector3> {
  private readonly s: number;
  private readonly r: number;
  private readonly top: number;
  constructor(s: number, r: number, top: number) {
    super();
    this.s = s;
    this.r = r;
    this.top = top;
  }
  getPoint(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    const { s, r } = this;
    const cT = this.top - r;
    const cB = cT - s;
    const arc = Math.PI * r;
    let d = (((u % 1) + 1) % 1) * (2 * arc + 2 * s);
    if (d < arc) return target.set(r * Math.cos(d / r), cT + r * Math.sin(d / r), 0);
    d -= arc;
    if (d < s) return target.set(-r, cT - d, 0);
    d -= s;
    if (d < arc) return target.set(r * Math.cos(Math.PI + d / r), cB + r * Math.sin(Math.PI + d / r), 0);
    return target.set(r, cB + (d - arc), 0);
  }
}

function makeMetal(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#e3c894', metalness: 1, roughness: 0.24 });
}

function createLinkMesh(mat: THREE.Material): THREE.Mesh {
  const curve = new StadiumCurve(LINK_S, KC.link.r, KC.link.t);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 72, KC.link.t, 10, true), mat);
}

function createJumpMesh(mat: THREE.Material): THREE.Mesh {
  const g = new THREE.TorusGeometry(KC.jump.R, KC.jump.t, 10, 48).translate(0, KC.jump.t - KC.jump.R, 0);
  return new THREE.Mesh(g, mat);
}

function createCoin(metal: THREE.MeshStandardMaterial): THREE.Group {
  const { R, rim, h, field, edge } = KC.coin;
  const Ri = R - rim;
  const coin = new THREE.Group();
  coin.name = 'keychain-coin';

  const bail = new THREE.Mesh(
    new THREE.TorusGeometry(KC.bail.R, KC.bail.t, 12, 48).translate(0, KC.bail.t - KC.bail.R, 0),
    metal,
  );
  coin.add(bail);

  const body = new THREE.Group();
  body.position.y = -COIN_D;
  coin.add(body);

  // Raised rim: field edge → rim top → rounded shoulder. Lathe around Y, then turn so thickness is Z.
  const profile = [new THREE.Vector2(Ri, field), new THREE.Vector2(Ri + 0.005, h), new THREE.Vector2(R - edge, h)];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    profile.push(new THREE.Vector2(R - edge + edge * Math.sin(a), h - edge + edge * Math.cos(a)));
  }
  const rimMat = metal.clone();
  rimMat.side = THREE.DoubleSide;
  const rimFront = new THREE.LatheGeometry(profile, 160).rotateX(Math.PI / 2);
  const rimBack = new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p.x, -p.y)), 160).rotateX(Math.PI / 2);
  body.add(new THREE.Mesh(rimFront, rimMat), new THREE.Mesh(rimBack, rimMat));

  const bandMat = metal.clone();
  bandMat.bumpMap = reedingMap(80); // same ridge pitch on the smaller edge
  bandMat.bumpScale = 1.2;
  const band = new THREE.CylinderGeometry(R, R, 2 * (h - edge), 120, 1, true).rotateX(Math.PI / 2);
  body.add(new THREE.Mesh(band, bandMat));

  for (const face of ['front', 'back'] as const) {
    const mat = new THREE.MeshStandardMaterial({
      ...coinFaceMaps(face),
      color: '#ffffff',
      metalness: 1,
      roughness: 1,
      bumpScale: 2.2,
    });
    const g = new THREE.CircleGeometry(Ri, 160);
    if (face === 'back') g.rotateY(Math.PI);
    g.translate(0, 0, face === 'front' ? field : -field);
    body.add(new THREE.Mesh(g, mat));
  }
  return coin;
}

export interface KeychainOptions {
  /** Sits at the lanyard bar centre. Local X = bar axis, local Y = device up, local Z = device front. */
  anchor: THREE.Object3D;
  /** Device body as an oriented box (in `object`'s local space). The chain and coin are kept outside it. */
  collider?: { object: THREE.Object3D; halfExtents: THREE.Vector3 };
  /** In W/s². Real scale is ≈180; lower reads slower and calmer. */
  gravity?: number;
  /** Hang still (no swing or twist); the coin stays clickable. */
  reducedMotion?: boolean;
}

const STEP = 1 / 240;
const MAX_STEPS = 12;
const TELEPORT = 0.5; // W: an anchor jump larger than this in one frame re-hangs instead of yanking
const TWIST_K = 18;
const TWIST_C = 4.2; // damping ratio ≈0.5: one visible overshoot, settles in ≈2 s
const TWIST_MAX = 2.2;
const DAMPING = 0.9965;
const MAX_BEND = THREE.MathUtils.degToRad(70);
const BAR_SIDE_SWING = THREE.MathUtils.degToRad(45); // slot width lets link 0 tilt along the bar
const BAR_FWD_SWING = THREE.MathUtils.degToRad(15); // and a little front/back (slot is 0.08 W deep in Z)

export class Keychain {
  readonly group = new THREE.Group();
  readonly coin: THREE.Group;
  gravity: number;
  reducedMotion: boolean;

  private readonly anchor: THREE.Object3D;
  private readonly collider?: KeychainOptions['collider'];
  private readonly segLen: number[];
  private readonly pos: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly invMass: number[];
  private readonly radius: number[];
  private readonly elements: THREE.Object3D[] = [];
  private acc = 0;
  private lastTop: THREE.Vector3 | null = null;
  private heading = 0; // unwrapped
  private rawHeading = 0;
  private psi = 0; // coin twist heading (lags the device heading)
  private psiV = 0;
  private impact = 0; // strongest coin-into-body approach speed since the last takeImpact() (W/s)

  constructor(opts: KeychainOptions) {
    this.anchor = opts.anchor;
    this.collider = opts.collider;
    this.gravity = opts.gravity ?? 42;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.group.name = 'keychain';

    const n = KC.link.count;
    this.segLen = [...Array(n).fill(KC.link.L), JUMP_L, COIN_D];
    this.invMass = [0, ...Array(n).fill(1), 1.4, 0.15];
    this.radius = [0, ...Array(n).fill(0.025), 0.021, KC.coin.R - 0.012];

    const metal = makeMetal();
    for (let i = 0; i < n; i++) this.elements.push(createLinkMesh(metal));
    this.elements.push(createJumpMesh(metal));
    this.coin = createCoin(metal);
    this.elements.push(this.coin);
    for (const e of this.elements) {
      e.matrixAutoUpdate = false;
      this.group.add(e);
    }
    for (let i = 0; i < this.segLen.length + 1; i++) {
      this.pos.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
  }

  /** Re-hang straight down from the bar (call after teleporting the device). */
  reset(): void {
    const top = this.barTop(new THREE.Vector3());
    let y = 0;
    this.pos.forEach((p, i) => {
      if (i > 0) y += this.segLen[i - 1];
      p.set(top.x, top.y - y, top.z);
      this.prev[i].copy(p);
    });
    this.lastTop = top.clone();
    this.heading = this.rawHeading = this.readHeading();
    this.psi = this.heading;
    this.psiV = 0;
  }

  /** Flick the coin sideways and give it a spin. */
  nudge(power = 1): void {
    if (this.reducedMotion) return;
    const q = this.anchor.getWorldQuaternion(_q);
    const side = _v1.set(1, 0, 0).applyQuaternion(q).multiplyScalar(0.02 * power);
    const fwd = _v2.set(0, 0, 1).applyQuaternion(q).multiplyScalar(0.008 * power);
    const last = this.pos.length - 1;
    this.prev[last].sub(side).sub(fwd);
    this.psiV += 5 * power;
  }

  /** Hardest the coin has hit the device body since the last call (W/s, body frame); resets it. */
  takeImpact(): number {
    const v = this.impact;
    this.impact = 0;
    return v;
  }

  update(dt: number): void {
    this.anchor.updateWorldMatrix(true, false);
    const top = this.barTop(_top);
    const q = this.anchor.getWorldQuaternion(_q);

    // First frame, reduced motion, tab resume or a scroll jump: re-hang rather than yank the chain.
    if (!this.lastTop || this.reducedMotion || dt > 0.25 || top.distanceTo(this.lastTop) > TELEPORT) {
      this.reset();
      this.sync(q);
      return;
    }

    this.acc = Math.min(this.acc + Math.min(dt, 0.1), STEP * MAX_STEPS);
    const steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;

    // Unwrapped device heading drives the coin's torsional lag.
    const h = this.readHeading();
    const dh = h - this.rawHeading;
    this.heading += Math.atan2(Math.sin(dh), Math.cos(dh));
    this.rawHeading = h;

    if (this.collider) _inv.copy(this.collider.object.matrixWorld).invert();
    for (let s = 0; s < steps; s++) {
      _p0.lerpVectors(this.lastTop, top, (s + 1) / steps);
      this.step(STEP, _p0, q);
    }
    if (steps > 0) this.lastTop.copy(top);
    this.sync(q);
  }

  private step(dt: number, p0: THREE.Vector3, q: THREE.Quaternion): void {
    const { pos, prev } = this;
    const g = this.gravity * dt * dt;
    for (let i = 1; i < pos.length; i++) {
      _v1.subVectors(pos[i], prev[i]).multiplyScalar(DAMPING);
      prev[i].copy(pos[i]);
      pos[i].add(_v1);
      pos[i].y -= g;
    }
    pos[0].copy(p0);
    prev[0].copy(p0);

    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < this.segLen.length; i++) this.solveDistance(i, i + 1, this.segLen[i]);
      this.limitBend();
      this.clampFirstLink(q);
      this.collide();
    }

    // Torsion: the coin's heading springs toward the device heading, underdamped.
    const acc = TWIST_K * (this.heading - this.psi) - TWIST_C * this.psiV;
    this.psiV += acc * dt;
    this.psi += this.psiV * dt;
  }

  private solveDistance(a: number, b: number, rest: number): void {
    const wa = this.invMass[a];
    const wb = this.invMass[b];
    const w = wa + wb;
    if (w === 0) return;
    _v1.subVectors(this.pos[b], this.pos[a]);
    const d = _v1.length();
    if (d < 1e-9) return;
    _v1.multiplyScalar((d - rest) / (d * w));
    this.pos[a].addScaledVector(_v1, wa);
    this.pos[b].addScaledVector(_v1, -wb);
  }

  private limitBend(): void {
    const cos = Math.cos(MAX_BEND);
    for (let i = 1; i < this.pos.length - 1; i++) {
      const a = this.segLen[i - 1];
      const b = this.segLen[i];
      const min = Math.sqrt(a * a + b * b + 2 * a * b * cos);
      _v1.subVectors(this.pos[i + 1], this.pos[i - 1]);
      const d = _v1.length();
      if (d >= min || d < 1e-9) continue;
      const wa = this.invMass[i - 1];
      const wb = this.invMass[i + 1];
      if (wa + wb === 0) continue;
      _v1.multiplyScalar((d - min) / (d * (wa + wb)));
      this.pos[i - 1].addScaledVector(_v1, wa);
      this.pos[i + 1].addScaledVector(_v1, -wb);
    }
  }

  /** Link 0 lives in a slot around the bar: it may swing along the bar and a little front/back. */
  private clampFirstLink(q: THREE.Quaternion): void {
    _iq.copy(q).invert();
    _v1.subVectors(this.pos[1], this.pos[0]).applyQuaternion(_iq);
    const down = Math.max(-_v1.y, 1e-4);
    const tx = THREE.MathUtils.clamp(Math.atan2(_v1.x, down), -BAR_SIDE_SWING, BAR_SIDE_SWING);
    const tz = THREE.MathUtils.clamp(Math.atan2(_v1.z, down), -BAR_FWD_SWING, BAR_FWD_SWING);
    _v1.set(Math.tan(tx), -1, Math.tan(tz)).normalize().multiplyScalar(this.segLen[0]).applyQuaternion(q);
    this.pos[1].copy(this.pos[0]).add(_v1);
  }

  private collide(): void {
    const c = this.collider;
    if (!c) return;
    const he = c.halfExtents;
    const coin = this.pos.length - 1;
    // From node 2: node 1 (link 0's lower end) sits in the slot opening, inside the body's collision
    // margin by construction, and clampFirstLink already keeps it in a cone pointing out of the slot.
    // Colliding it too made the clamp and the box fight each step, which could lock the chain in an
    // L along the bottom face.
    for (let i = 2; i < this.pos.length; i++) {
      const r = this.radius[i];
      const p = _v2.copy(this.pos[i]).applyMatrix4(_inv); // inverse computed once per frame
      const ox = he.x + r - Math.abs(p.x);
      const oy = he.y + r - Math.abs(p.y);
      const oz = he.z + r - Math.abs(p.z);
      if (ox <= 0 || oy <= 0 || oz <= 0) continue;
      const axis = ox < oy && ox < oz ? 'x' : oy < oz ? 'y' : 'z';
      const side = Math.sign(p[axis] || 1);
      if (i === coin) {
        // Inward speed along the push-out axis, measured in the body's frame so its own motion counts.
        const was = _v3.copy(this.prev[i]).applyMatrix4(_inv);
        this.impact = Math.max(this.impact, (-(p[axis] - was[axis]) * side) / STEP);
      }
      p[axis] = side * (he[axis] + r);
      this.pos[i].copy(p.applyMatrix4(c.object.matrixWorld));
    }
  }

  /** Orient every element on its segment with parallel-transported frames (no roll flips). */
  private sync(q: THREE.Quaternion): void {
    const base = _base.set(1, 0, 0).applyQuaternion(q); // bar axis = link 0's plane normal
    // Soft limit: a hard clamp would visibly freeze the coin mid-turn after a 180° device flip.
    const twist = TWIST_MAX * Math.tanh((this.psi - this.heading) / TWIST_MAX);
    const last = this.elements.length - 1;
    this.elements.forEach((el, k) => {
      const a = _a.subVectors(this.pos[k + 1], this.pos[k]).normalize();
      base.addScaledVector(a, -a.dot(base));
      if (base.lengthSq() < 1e-8) base.set(0, 0, 1).addScaledVector(a, -a.z);
      base.normalize();
      const n = _n.copy(base).applyAxisAngle(a, twist * (k / last));
      if (k % 2 === 1) n.crossVectors(a, _v2.copy(n));
      const y = _y.copy(a).negate();
      const x = _x.crossVectors(y, n);
      el.matrix.makeBasis(x, y, n).setPosition(this.pos[k]);
      el.matrixWorldNeedsUpdate = true;
    });
  }

  private barTop(target: THREE.Vector3): THREE.Vector3 {
    return this.anchor.localToWorld(target.set(0, KC.barRadius, 0));
  }

  private readHeading(): number {
    const z = _v2.set(0, 0, 1).applyQuaternion(this.anchor.getWorldQuaternion(_q2));
    return Math.atan2(z.x, z.z);
  }
}

/**
 * Slot opening in the bottom face (add to the device at the anchor). The bar and cavity sit inside the
 * opaque body, so the opening is a flush dark rounded-rect with a thin bevel lip, not a cut. Link 0's
 * upper arc passes into it. It must stay within the flat part of the bottom face:
 * |z| ≤ bodyHalfThickness − edgeRadius.
 */
export const SLOT = { halfX: 0.02, halfZ: 0.03, depthAboveFace: 0.02 } as const;

export function createLanyardSlot(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lanyard-slot';
  const rr = (hx: number, hz: number, r: number) => {
    const s = new THREE.Shape();
    s.moveTo(-hx + r, -hz);
    s.lineTo(hx - r, -hz);
    s.quadraticCurveTo(hx, -hz, hx, -hz + r);
    s.lineTo(hx, hz - r);
    s.quadraticCurveTo(hx, hz, hx - r, hz);
    s.lineTo(-hx + r, hz);
    s.quadraticCurveTo(-hx, hz, -hx, hz - r);
    s.lineTo(-hx, -hz + r);
    s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
    return s;
  };
  const face = -SLOT.depthAboveFace;
  const lipMat = new THREE.MeshStandardMaterial({ color: '#3a3b42', metalness: 0.6, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1 });
  const holeMat = new THREE.MeshBasicMaterial({ color: '#040405', polygonOffset: true, polygonOffsetFactor: -2 });
  const lip = new THREE.Mesh(new THREE.ShapeGeometry(rr(SLOT.halfX + 0.003, SLOT.halfZ + 0.003, 0.008), 4), lipMat);
  const hole = new THREE.Mesh(new THREE.ShapeGeometry(rr(SLOT.halfX, SLOT.halfZ, 0.006), 4), holeMat);
  for (const m of [lip, hole]) {
    m.rotation.x = Math.PI / 2; // shape XY → faces −Y (out of the bottom face)
    m.position.y = face - 0.0004;
    g.add(m);
  }
  return g;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _iq = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _top = new THREE.Vector3();
const _base = new THREE.Vector3();
const _a = new THREE.Vector3();
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
