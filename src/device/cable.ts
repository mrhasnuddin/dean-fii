// The device's USB-C cable (docs/device-design.md §33): a plug seated in the bottom port and a cable that
// leaves its boot, hangs and swings under gravity, and fades out along its length (it leaves the frame, and
// never runs behind the page copy). Same family as keychain.ts: world-space Verlet, the device's own motion
// carries it, it hangs still under reduced motion. Sizes are in W (device body width). The cable is plain dark
// grey (§35) and the plug's head is thin-film iridescent, like the body.
import * as THREE from 'three';

export const CABLE = {
  r: 0.0155,
  segs: 12,
  seg: 0.064, // 0.77 W of cable
  colour: '#928b74', // reads as a neutral dark grey: the studio light is blue-violet, so the material is warm to cancel it (a neutral one rendered navy)
  stub: 0.045, // W: the strain relief keeps this much of the cable straight out of the boot
  fade: [0.13, 0.5] as const, // W along the cable: fully opaque until the first, gone by the second
} as const;

/** Plug dimensions, from the cable attach point (y = 0) toward the tip (−Y). */
export const PLUG = { cone: 0.06, boot: 0.095, shell: 0.05, inside: 0.02, bootW: 0.17, bootT: 0.054, shellW: 0.134, shellT: 0.03 } as const;
/** Distance from the attach point to the face the shell comes out of. */
export const PLUG_REACH = PLUG.cone + PLUG.boot + PLUG.shell;

/** The plug's head (boot and cone): thin-film iridescent graphite like the body, or satin graphite on weak GPUs. */
export function makeHeadMaterial(tier: 'high' | 'low' = 'high'): THREE.MeshPhysicalMaterial {
  return tier === 'high'
    ? new THREE.MeshPhysicalMaterial({
        name: 'plug-head-iridescent', color: '#5a5c69', metalness: 1, roughness: 0.2,
        iridescence: 1, iridescenceIOR: 2.0, iridescenceThicknessRange: [150, 750], clearcoat: 0.6, clearcoatRoughness: 0.15,
      })
    : new THREE.MeshPhysicalMaterial({ name: 'plug-head-graphite', color: '#1a1b20', metalness: 0.4, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.35 });
}

function stadium(w: number, h: number): THREE.Shape {
  const r = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -r);
  s.lineTo(w / 2 - r, -r);
  s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, r);
  s.absarc(-w / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

/** Extrusion of a stadium from y = −from to y = −(from + depth) (the shape's X stays X, its Y becomes Z). */
function stadiumBar(w: number, h: number, from: number, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(stadium(w - 2 * bevel, h - 2 * bevel), {
    depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16,
  });
  return g.translate(0, 0, from + bevel).rotateX(Math.PI / 2);
}

/** A USB-C plug, cable attach point at the origin, tip along −Y: strain-relief cone, boot, steel shell. */
export function createUsbCPlug(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'usb-c-plug';
  const head = makeHeadMaterial();
  const steel = new THREE.MeshStandardMaterial({ color: '#c3c5cc', roughness: 0.26, metalness: 1 });
  // The cone flares from the cable's round section into the boot's wide one.
  const cone = new THREE.CylinderGeometry(CABLE.r * 1.1, PLUG.bootT / 2, PLUG.cone, 28, 10).translate(0, -PLUG.cone / 2, 0);
  const pos = cone.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = -pos.getY(i) / PLUG.cone; // 0 at the cable, 1 at the boot
    pos.setX(i, pos.getX(i) * (1 + (PLUG.bootW / PLUG.bootT - 1) * t * t));
  }
  cone.computeVertexNormals();
  const coneMesh = new THREE.Mesh(cone, head);
  const boot = new THREE.Mesh(stadiumBar(PLUG.bootW, PLUG.bootT, PLUG.cone, PLUG.boot, 0.007), head);
  coneMesh.name = boot.name = 'usb-head'; // refineMaterials swaps their material for the tier's
  g.add(coneMesh, boot);
  const shell = new THREE.Mesh(stadiumBar(PLUG.shellW, PLUG.shellT, PLUG_REACH - PLUG.shell, PLUG.shell + PLUG.inside, 0.003), steel);
  g.add(shell);
  // The tip's dark cavity, as a USB-C plug has: a slim opening in the shell's end face.
  const cavity = new THREE.Mesh(new THREE.ShapeGeometry(stadium(PLUG.shellW - 0.03, PLUG.shellT - 0.014), 10), new THREE.MeshBasicMaterial({ color: '#08080a' }));
  cavity.rotation.x = Math.PI / 2;
  cavity.position.y = -(PLUG_REACH + PLUG.inside) - 0.0006;
  g.add(cavity);
  g.traverse((o) => (o.userData.explodeWithParent = true));
  return g;
}

export interface CableOptions {
  /** The plug's attach point on the device: local −Y is the way out, local Z the device's front. */
  anchor: THREE.Object3D;
  /** Device body as an oriented box (in `object`'s local space). The cable is kept outside it. */
  collider?: { object: THREE.Object3D; halfExtents: THREE.Vector3 };
  gravity?: number;
  reducedMotion?: boolean;
}

const STEP = 1 / 240;
const MAX_STEPS = 12;
const TELEPORT = 0.5; // W: an anchor jump larger than this in one frame re-hangs
const DAMPING = 0.9965;
const RING = 10; // vertices round the tube
const PER = 4; // tube samples per segment
const N = CABLE.segs + 1;
// A cable resists bending: tighter at the boot, then easing off along its length.
const bendAt = (i: number) => THREE.MathUtils.degToRad(i <= 2 ? 16 : i <= 5 ? 30 : 46);

export class Cable {
  readonly group = new THREE.Group();
  gravity: number;
  reducedMotion: boolean;
  private paused = false;

  private readonly anchor: THREE.Object3D;
  private readonly collider?: CableOptions['collider'];
  private readonly pos: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly invMass: number[] = [];
  private readonly curve = new THREE.CatmullRomCurve3();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly dir = new THREE.Vector3(0, -1, 0); // the way out of the plug, in world space
  private readonly normal0 = new THREE.Vector3(0, 0, 1);
  private acc = 0;
  private lastTop: THREE.Vector3 | null = null;

  constructor(opts: CableOptions) {
    this.anchor = opts.anchor;
    this.collider = opts.collider;
    this.gravity = opts.gravity ?? 42;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.group.name = 'usb-cable';
    for (let i = 0; i < N; i++) {
      this.pos.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
      this.invMass.push(i === 0 ? 0 : 1);
    }
    this.curve.points = this.pos;
    this.curve.curveType = 'centripetal';

    const samples = CABLE.segs * PER + 1;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(samples * RING * 3), 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(samples * RING * 3), 3));
    // Opacity along the cable, as the alpha of a white vertex colour: it falls to nothing toward the free end.
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(samples * RING * 4), 4));
    this.setFade(...CABLE.fade);
    const index: number[] = [];
    for (let s = 0; s < samples - 1; s++) {
      for (let k = 0; k < RING; k++) {
        const a = s * RING + k, b = s * RING + ((k + 1) % RING), c = a + RING, d = b + RING;
        index.push(a, c, b, b, c, d);
      }
    }
    this.geometry.setIndex(index);
    const tube = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({ color: CABLE.colour, roughness: 0.42, metalness: 0, vertexColors: true, transparent: true }));
    tube.frustumCulled = false;
    this.group.add(tube);
  }

  /** Where along the cable (W) it is fully opaque until `from` and gone by `to`. Phones fade it sooner: it would run behind the page copy. */
  setFade(from: number, to: number): void {
    const colour = this.geometry.attributes.color as THREE.BufferAttribute;
    const samples = CABLE.segs * PER + 1;
    for (let s = 0; s < samples; s++) {
      const a = 1 - THREE.MathUtils.smoothstep((s / (samples - 1)) * CABLE.segs * CABLE.seg, from, to);
      for (let k = 0; k < RING; k++) colour.setXYZW(s * RING + k, 1, 1, 1, a);
    }
    colour.needsUpdate = true;
  }

  /** Unplugged and out of the frame: hidden and not simulated; plugging in again re-hangs it from the plug. */
  setPaused(on: boolean): void {
    this.paused = on;
    this.group.visible = !on;
    if (!on) this.lastTop = null;
  }

  /** Re-hang from the plug: out along its axis, then straight down. */
  reset(): void {
    this.readAnchor(_top);
    this.pos.forEach((p, i) => {
      if (i === 0) p.copy(_top);
      else if (i === 1) p.copy(_top).addScaledVector(this.dir, CABLE.stub);
      else p.copy(this.pos[i - 1]).add(_down.set(0, -CABLE.seg, 0));
      this.prev[i].copy(p);
    });
    this.lastTop = _top.clone();
    this.build();
  }

  update(dt: number): void {
    if (this.paused) return;
    this.anchor.updateWorldMatrix(true, false);
    const top = this.readAnchor(_top);
    if (!this.lastTop || this.reducedMotion || dt > 0.25 || top.distanceTo(this.lastTop) > TELEPORT) {
      this.reset();
      return;
    }
    this.acc = Math.min(this.acc + Math.min(dt, 0.1), STEP * MAX_STEPS);
    const steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;
    const col = this.collider?.object;
    if (col) {
      col.updateWorldMatrix(true, false);
      _inv.copy(col.matrixWorld).invert();
    }
    for (let s = 0; s < steps; s++) this.step(STEP, _p0.lerpVectors(this.lastTop, top, (s + 1) / steps));
    if (steps > 0) this.lastTop.copy(top);
    this.build();
  }

  private step(dt: number, p0: THREE.Vector3): void {
    const { pos, prev } = this;
    const g = this.gravity * dt * dt;
    for (let i = 1; i < N; i++) {
      _v1.subVectors(pos[i], prev[i]).multiplyScalar(DAMPING);
      prev[i].copy(pos[i]);
      pos[i].add(_v1);
      pos[i].y -= g;
    }
    pos[0].copy(p0);
    prev[0].copy(p0);
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < N - 1; i++) this.solveDistance(i, i + 1, CABLE.seg);
      for (let i = 1; i < N - 1; i++) this.limitBend(i);
      pos[1].copy(p0).addScaledVector(this.dir, CABLE.stub); // out of the boot straight
      this.collide();
    }
  }

  private solveDistance(a: number, b: number, rest: number): void {
    const w = this.invMass[a] + this.invMass[b];
    if (w === 0) return;
    _v1.subVectors(this.pos[b], this.pos[a]);
    const d = _v1.length();
    if (d < 1e-9) return;
    _v1.multiplyScalar((d - rest) / (d * w));
    this.pos[a].addScaledVector(_v1, this.invMass[a]);
    this.pos[b].addScaledVector(_v1, -this.invMass[b]);
  }

  /** Keeps nodes i−1 and i+1 at least as far apart as a bend of `bendAt(i)` allows. */
  private limitBend(i: number): void {
    const min = CABLE.seg * Math.sqrt(2 + 2 * Math.cos(bendAt(i)));
    _v1.subVectors(this.pos[i + 1], this.pos[i - 1]);
    const d = _v1.length();
    const wa = this.invMass[i - 1];
    const wb = this.invMass[i + 1];
    if (d >= min || d < 1e-9 || wa + wb === 0) return;
    _v1.multiplyScalar((d - min) / (d * (wa + wb)));
    this.pos[i - 1].addScaledVector(_v1, wa);
    this.pos[i + 1].addScaledVector(_v1, -wb);
  }

  /** Nodes from the third on are pushed out of the device body (the first two live in the boot). */
  private collide(): void {
    const c = this.collider;
    if (!c) return;
    const he = c.halfExtents;
    for (let i = 2; i < N; i++) {
      const p = _v2.copy(this.pos[i]).applyMatrix4(_inv);
      const ox = he.x + CABLE.r - Math.abs(p.x);
      const oy = he.y + CABLE.r - Math.abs(p.y);
      const oz = he.z + CABLE.r - Math.abs(p.z);
      if (ox <= 0 || oy <= 0 || oz <= 0) continue;
      const axis = ox < oy && ox < oz ? 'x' : oy < oz ? 'y' : 'z';
      const side = Math.sign(p[axis] || 1);
      const was = _v3.copy(this.prev[i]).applyMatrix4(_inv);
      p[axis] = side * (he[axis] + CABLE.r);
      was[axis] = p[axis]; // inelastic: the speed into the face goes with the overlap
      this.prev[i].copy(was.applyMatrix4(c.object.matrixWorld));
      this.pos[i].copy(p.applyMatrix4(c.object.matrixWorld));
    }
  }

  private readAnchor(target: THREE.Vector3): THREE.Vector3 {
    this.anchor.getWorldPosition(target);
    const q = this.anchor.getWorldQuaternion(_q);
    this.dir.set(0, -1, 0).applyQuaternion(q);
    this.normal0.set(0, 0, 1).applyQuaternion(q);
    return target;
  }

  /** Sweeps the tube along a smooth curve through the nodes (parallel-transported rings). */
  private build(): void {
    const samples = CABLE.segs * PER + 1;
    const p = this.geometry.attributes.position as THREE.BufferAttribute;
    const n = this.geometry.attributes.normal as THREE.BufferAttribute;
    const nrm = _n.copy(this.normal0);
    let prevT: THREE.Vector3 | null = null;
    for (let s = 0; s < samples; s++) {
      const u = s / (samples - 1);
      this.curve.getPoint(u, _c);
      this.curve.getTangent(u, _t);
      if (prevT) nrm.applyQuaternion(_q2.setFromUnitVectors(prevT, _t));
      else nrm.addScaledVector(_t, -nrm.dot(_t));
      nrm.normalize();
      _b.crossVectors(_t, nrm);
      for (let k = 0; k < RING; k++) {
        const a = (k / RING) * Math.PI * 2;
        _r.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(_b, Math.sin(a));
        const i = s * RING + k;
        p.setXYZ(i, _c.x + _r.x * CABLE.r, _c.y + _r.y * CABLE.r, _c.z + _r.z * CABLE.r);
        n.setXYZ(i, _r.x, _r.y, _r.z);
      }
      (prevT ??= new THREE.Vector3()).copy(_t);
    }
    p.needsUpdate = n.needsUpdate = true;
  }
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const _top = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _down = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _r = new THREE.Vector3();
