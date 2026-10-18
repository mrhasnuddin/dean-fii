// The device's side details (docs/device-design.md §34), added by walletRefine after the shell exists:
//   left face   Motion slider (top) · volume knob · battery window (digital LED bar) · Sound slider (bottom)
//               (the knob and the two sliders are the site's settings: the eye's callouts explain them, §36)
//   bottom face memory-card slot (x −0.3) · USB-C port with its plug (centre, walletRefine) · reset pinhole (x +0.3)
// Each is its own node, so it can animate; controls.ts gives each its hit area and its job. Units: W.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { roundedRectShape } from './shapes';
import { createMemorySlot, MEMORY } from './memoryCard';

/** Volume knob: a knurled crown, axis −X, out of the left face. `range`: degrees of turn, minimum to maximum. */
export const KNOB = { y: 0.25, r: 0.05, out: 0.055, range: 270 } as const;
/** Motion slider: up = motion on. `travel`: how far the knob slides between its two ends. */
export const MOTION_SW = { y: 0.535, slot: 0.15, travel: 0.04 } as const;
/** Sound slider: up = sound on (effects and music). Same slider as the Motion one. */
export const SOUND_SW = { y: -0.47, slot: 0.15, travel: 0.04 } as const;
/** Battery window: five LED segments, bottom to top. */
export const BATTERY = { y: -0.12, len: 0.3, w: 0.062, segs: 5, seg: 0.046, gap: 0.008, segW: 0.044 } as const;
export const PINHOLE_X = 0.3;

export interface SideCtx {
  shell: THREE.Object3D;
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  zMid: number;
  /** A dark rounded-rect decal on a side face (walletRefine's `recess`). */
  recess(name: string, w: number, h: number, pos: THREE.Vector3, rotY: number): THREE.Object3D;
  /** Any mesh stuck on a side face, named and added to the shell. */
  onSide(m: THREE.Object3D, name: string, pos: THREE.Vector3, rotY: number): THREE.Object3D;
  glyphMat: THREE.Material;
}

const L = -0.5 - 0.0004;

export function addSideParts(c: SideCtx): void {
  const { shell, nodes, meshes, sockets, zMid } = c;

  // ---- Volume knob. The generator's thumb roller stays in the model, hidden: the knob is its replacement.
  const roller = nodes['roller'];
  if (roller) roller.visible = false;
  const knobNode = new THREE.Group();
  knobNode.name = 'volume-knob__pivot';
  knobNode.position.set(-0.5, KNOB.y, zMid);
  knobNode.rotation.z = Math.PI / 2; // local +Y → out of the left face (−X); local +Z stays the device's front
  const top = KNOB.out;
  const ch = 0.009;
  const r = KNOB.r;
  const profile = [
    new THREE.Vector2(0.0001, -0.035), new THREE.Vector2(r, -0.035), new THREE.Vector2(r, top - ch),
    new THREE.Vector2(r - ch * 0.35, top - ch * 0.2), new THREE.Vector2(r - ch, top), new THREE.Vector2(0.0001, top),
  ];
  const spin = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), new THREE.MeshStandardMaterial()); // champagne: refineMaterials
  spin.name = 'volume-knob';
  // Knurl: 36 ridges round the rim, riding the knob; they scroll past as it turns.
  const RIDGES = 36;
  const ridge = new THREE.BoxGeometry(0.0052, 0.045, 0.008);
  const knurl = new THREE.InstancedMesh(ridge, spin.material as THREE.Material, RIDGES);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < RIDGES; i++) {
    const a = (i / RIDGES) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(new THREE.Vector3(Math.cos(a) * (r + 0.001), 0.01, Math.sin(a) * (r + 0.001)), q, new THREE.Vector3(1, 1, 1));
    knurl.setMatrixAt(i, m);
  }
  knurl.name = 'volume-knurl';
  knurl.userData.explodeWithParent = true;
  knurl.userData.handBuilt = true;
  spin.add(knurl);
  // The pointer: a dark stripe along the rim that faces the front at half volume, and climbs as it turns up.
  const pointer = new THREE.Mesh(
    new THREE.BoxGeometry(0.007, 0.05, 0.004),
    new THREE.MeshStandardMaterial({ color: '#1c1d21', roughness: 0.6 }),
  );
  pointer.name = 'volume-pointer';
  pointer.position.set(0, 0.01, r + 0.0015);
  pointer.userData.explodeWithParent = true;
  spin.add(pointer);
  knobNode.add(spin);
  shell.add(knobNode);
  nodes['volume-knob'] = knobNode;
  meshes['volume-knob'] = spin;
  // Its seat in the face, and the + / − marks beside it.
  c.onSide(new THREE.Mesh(new THREE.CircleGeometry(0.062, 40), new THREE.MeshBasicMaterial({ color: '#050506', polygonOffset: true, polygonOffsetFactor: -2 })),
    'volume-seat', new THREE.Vector3(L, KNOB.y, zMid), -Math.PI / 2);
  const bar = (w: number, h: number) => roundedRectShape(w, h, Math.min(w, h) / 2);
  const mark = (name: string, shapes: THREE.Shape[], y: number) =>
    c.onSide(new THREE.Mesh(new THREE.ShapeGeometry(shapes, 4), c.glyphMat), name, new THREE.Vector3(L, y, zMid), -Math.PI / 2);
  mark('volume-plus', [bar(0.026, 0.005), bar(0.005, 0.026)], KNOB.y + 0.09);
  mark('volume-minus', [bar(0.026, 0.005)], KNOB.y - 0.09);

  // ---- Two sliders, the view switch's twins on the left face: Motion (up = motion on) and Sound (up = sound on).
  const slider = (name: string, y: number, travel: number) => {
    const sw = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.07, 0.04, 3, 0.008), new THREE.MeshStandardMaterial());
    sw.name = `${name}-switch`;
    for (const dy of [-0.016, 0, 0.016]) {
      const grip = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.006, 0.03, 2, 0.0025), sw.material as THREE.Material);
      grip.name = `${name}-grip`;
      grip.position.set(-0.0185, dy, 0);
      grip.userData.explodeWithParent = true;
      sw.add(grip);
    }
    const node = new THREE.Group();
    node.name = `${name}-switch__pivot`;
    node.position.set(-0.5125, y + travel, zMid);
    node.add(sw);
    shell.add(node);
    nodes[`${name}-switch`] = node;
    meshes[`${name}-switch`] = sw;
    c.recess(`${name}-slot`, 0.05, MOTION_SW.slot, new THREE.Vector3(L, y, zMid), -Math.PI / 2);
  };
  slider('motion', MOTION_SW.y, MOTION_SW.travel);
  slider('sound', SOUND_SW.y, SOUND_SW.travel);
  const icon = (name: string, shapes: THREE.Shape[], y: number) =>
    c.onSide(new THREE.Mesh(new THREE.ShapeGeometry(shapes, 6), c.glyphMat), name, new THREE.Vector3(L, y, zMid), -Math.PI / 2);
  // Icons at the two ends: a dot orbiting its ring (motion on, up), and the ring dashed and parked (off, down).
  const ringOn = new THREE.Shape();
  ringOn.absarc(0, 0, 0.0115, 0, Math.PI * 2, false);
  ringOn.holes.push(new THREE.Path().absarc(0, 0, 0.0082, 0, Math.PI * 2, true));
  const dot = new THREE.Shape();
  dot.absarc(0.0115, 0, 0.0028, 0, Math.PI * 2, false);
  icon('motion-icon-on', [ringOn, dot], MOTION_SW.y + 0.11);
  const dashes = Array.from({ length: 6 }, (_, i) => {
    const a0 = (i / 6) * Math.PI * 2 + 0.12;
    const a1 = a0 + Math.PI / 6;
    const s = new THREE.Shape();
    s.absarc(0, 0, 0.0115, a0, a1, false);
    s.absarc(0, 0, 0.0082, a1, a0, true);
    return s;
  });
  icon('motion-icon-off', dashes, MOTION_SW.y - 0.11);
  // Sound's ends: level bars (on, up: three that rise, like the old equaliser icon) and three flat dots (off, down).
  icon('sound-icon-on', [0.006, 0.014, 0.022].map((h, i) => roundedRectShape(0.005, h, 0.0025, (i - 1) * 0.0085, (h - 0.022) / 2)), SOUND_SW.y + 0.11);
  icon('sound-icon-off', [-1, 0, 1].map((i) => roundedRectShape(0.005, 0.005, 0.0025, i * 0.0085, 0)), SOUND_SW.y - 0.11);

  // ---- Battery window: a dark window with five LED segments (bottom to top) and a bolt above it.
  c.recess('battery-window', BATTERY.w, BATTERY.len, new THREE.Vector3(L, BATTERY.y, zMid), -Math.PI / 2);
  const segments: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < BATTERY.segs; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: '#22242a', roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -3 });
    segments.push(mat);
    const y = BATTERY.y - ((BATTERY.segs - 1) / 2) * (BATTERY.seg + BATTERY.gap) + i * (BATTERY.seg + BATTERY.gap);
    c.onSide(new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(BATTERY.segW, BATTERY.seg, 0.009), 5), mat), `battery-seg-${i}`,
      new THREE.Vector3(L - 0.0003, y, zMid), -Math.PI / 2);
  }
  const bolt = new THREE.Shape();
  bolt.moveTo(0.0035, 0.019);
  bolt.lineTo(-0.0075, -0.0015);
  bolt.lineTo(-0.0005, -0.0015);
  bolt.lineTo(-0.0035, -0.019);
  bolt.lineTo(0.0075, 0.0015);
  bolt.lineTo(0.0005, 0.0015);
  bolt.closePath();
  const boltMat = new THREE.MeshStandardMaterial({ color: '#5a5b63', roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  c.onSide(new THREE.Mesh(new THREE.ShapeGeometry(bolt, 2), boltMat), 'battery-bolt',
    new THREE.Vector3(L, BATTERY.y + BATTERY.len / 2 + 0.042, zMid), -Math.PI / 2);
  shell.userData.battery = { segments, bolt: boltMat };

  // ---- Bottom face: the memory-card slot and the reset pinhole (the USB-C port is walletRefine's).
  const slot = new THREE.Object3D();
  slot.name = 'memory-slot-socket';
  slot.position.set(MEMORY.x, -0.75, zMid);
  slot.add(createMemorySlot());
  shell.add(slot);
  sockets['shell:memory-slot'] = slot;

  const pin = new THREE.Group();
  pin.name = 'reset-pinhole';
  pin.position.set(PINHOLE_X, -0.75 - 0.0004, zMid);
  pin.rotation.x = Math.PI / 2; // shape XY → faces −Y
  pin.add(
    new THREE.Mesh(new THREE.RingGeometry(0.0085, 0.0125, 32), new THREE.MeshStandardMaterial({ color: '#c3c5cc', metalness: 1, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 })),
    new THREE.Mesh(new THREE.CircleGeometry(0.0085, 24), new THREE.MeshBasicMaterial({ color: '#030304', polygonOffset: true, polygonOffsetFactor: -3 })),
  );
  shell.add(pin);
}
