// Hand refinement of the generated wallet factory (img2threejs `refine-code`). The generator emits
// structure, pivots, sockets and unit primitives; this module swaps in the geometry it cannot emit.
// Every change here is recorded in the spec (geometryDescriptor.handRefinement / localFeatures) so
// the generated code is never the only copy of a reconstruction decision.
// Units: W (body width = 1). Mesh geometry is in each component node's local frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { D_PATH, STAR_PATH } from '../brand/logo';
import { coinFaceMaps } from './coinTextures';
import { createLanyardSlot } from './keychain';

export type WalletRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
};

// Side/top/bottom faces are flat only within |z| ≤ t/2 − edge = 0.045 W; every recess stays inside it.
const BODY = { w: 1, h: 1.5, t: 0.15, corner: 0.09, edge: 0.03 };

export function runtimeOf(root: THREE.Object3D): WalletRuntime {
  return root.userData.sculptRuntime as WalletRuntime;
}

/** Rounded rectangle centred on the origin (optionally elliptical corners for unit-scaled parents). */
export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  const x = cx - w / 2;
  const y = cy - h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function swap(mesh: THREE.Mesh | undefined, geometry: THREE.BufferGeometry): void {
  if (!mesh) return;
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

/** Chamfered key cap as a lathe about Y (the attached-cylinder mesh is already oriented Y → axis). */
function keyCap(radius: number, height: number, chamfer: number): THREE.LatheGeometry {
  const h = height / 2;
  const pts = [
    new THREE.Vector2(0.0001, -h),
    new THREE.Vector2(radius, -h),
    new THREE.Vector2(radius, h - chamfer),
    new THREE.Vector2(radius - chamfer * 0.35, h - chamfer * 0.2),
    new THREE.Vector2(radius - chamfer, h),
    new THREE.Vector2(0.0001, h),
  ];
  return new THREE.LatheGeometry(pts, 96);
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, color = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function logoShapes(paths: readonly string[]): THREE.Shape[] {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
  return new SVGLoader().parse(svg).paths.flatMap((p) => SVGLoader.createShapes(p));
}

/** Everything the `form-refinement` pass adds. Idempotent per model instance. */
export function refineForm(root: THREE.Object3D): void {
  if (root.userData.formRefined) return;
  root.userData.formRefined = true;
  const { nodes, meshes, sockets } = runtimeOf(root);
  const b = BODY.edge;

  // Shell: 0.03 W face-to-side roll-off. Outline inset by the bevel so the bevel grows it back to
  // 1 × 1.5; geometry shifted +b so it still spans z 0..t in the shell node (as the generator's did).
  const shell = new THREE.ExtrudeGeometry(roundedRectShape(BODY.w - 2 * b, BODY.h - 2 * b, BODY.corner - b), {
    depth: BODY.t - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 6,
    curveSegments: 24,
  }).translate(0, 0, b);
  swap(meshes['shell'], shell);

  // Front glass: flat face only (0.94 × 1.44, corner 0.06), a hair of bevel for a crisp edge glint.
  const g = 0.0015;
  swap(meshes['front-glass'], new THREE.ExtrudeGeometry(roundedRectShape(0.94 - 2 * g, 1.44 - 2 * g, 0.06 - g), {
    depth: 0.004 - 2 * g, bevelEnabled: true, bevelThickness: g, bevelSize: g, bevelSegments: 2, curveSegments: 24,
  }).translate(0, 0, g));

  // Display: 0.025 W corner radius; plus the lighter window lip (0.836 × 1.11) around it.
  swap(meshes['display'], new THREE.ShapeGeometry(roundedRectShape(0.795, 1.06, 0.025), 12));
  const lipShape = roundedRectShape(0.836, 1.11, 0.04);
  lipShape.holes.push(roundedRectShape(0.806, 1.072, 0.03) as unknown as THREE.Path);
  const lip = new THREE.Mesh(
    new THREE.ShapeGeometry(lipShape, 12),
    new THREE.MeshPhysicalMaterial({ color: '#3a3b42', roughness: 0.35, metalness: 0.2, clearcoat: 0.6 }),
  );
  lip.name = 'display-window-lip';
  lip.position.set(0, -0.002, -0.0003); // display node sits at the screen centre, just above the glass
  lip.userData.explodeWithParent = true;
  nodes['display']?.add(lip);

  // Keys: chamfered lathe caps (96 segments) + engraved caps.
  swap(meshes['key-confirm'], keyCap(0.085, 0.014, 0.006));
  swap(meshes['key-back'], keyCap(0.06, 0.01, 0.005));
  const confirmCap = coinFaceMaps('front');
  addCapFace(meshes['key-confirm'], 0.079, 0.007, new THREE.MeshStandardMaterial({
    ...confirmCap, color: '#ffffff', metalness: 1, roughness: 1, bumpScale: 1.6, envMapIntensity: 1.7,
  }));
  addCapFace(meshes['key-back'], 0.055, 0.005, new THREE.MeshStandardMaterial({
    color: '#26282f',
    roughness: 0.5,
    bumpMap: canvasTexture(256, (ctx, s) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, s, s);
      ctx.filter = 'blur(2px)';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = s * 0.07;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.58, s * 0.3);
      ctx.lineTo(s * 0.4, s * 0.5);
      ctx.lineTo(s * 0.58, s * 0.7);
      ctx.stroke();
    }),
    bumpScale: 1.4,
  }));

  // Roller: smooth 96-segment disc + 72 knurl ridges (repetition system roller-knurl), riding the disc.
  // DC-2: 0.06 W thick and 0.05 W proud of the side, so it reads (and hits) as a scroll wheel.
  swap(meshes['roller'], new THREE.CylinderGeometry(0.18, 0.18, 0.06, 96));
  const rollerMesh = meshes['roller'];
  if (rollerMesh) {
    const ridge = new THREE.BoxGeometry(0.006, 0.06, 0.009);
    const knurl = new THREE.InstancedMesh(ridge, rollerMesh.material as THREE.Material, 72);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      m.compose(new THREE.Vector3(Math.cos(a) * 0.182, 0, Math.sin(a) * 0.182), q, new THREE.Vector3(1, 1, 1));
      knurl.setMatrixAt(i, m);
    }
    knurl.name = 'roller-knurl';
    knurl.userData.explodeWithParent = true;
    knurl.userData.handBuilt = true;
    rollerMesh.add(knurl);
  }

  // Tabs, switch, card: rounded boxes at their real sizes (generator geometry was unit boxes pre-scaled).
  // DC-2 (surface pass): tabs 0.08 W tall with the section number engraved on the front face.
  const glyphMat = new THREE.MeshStandardMaterial({
    color: '#7a7b83', roughness: 0.6, transparent: true, polygonOffset: true, polygonOffsetFactor: -2,
  });
  for (let i = 1; i <= 4; i++) {
    const tab = meshes[`tab-0${i}`];
    swap(tab, new RoundedBoxGeometry(0.12, 0.08, 0.08, 3, 0.01));
    if (!tab) continue;
    // Mid grey reads engraved on both finishes: light on the dark polymer, dark on champagne (active).
    const numeral = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.05), glyphMat.clone());
    (numeral.material as THREE.MeshStandardMaterial).alphaMap = textTexture(`0${i}`, 256, 160, { size: 118, spacing: 6 });
    numeral.name = `tab-0${i}-numeral`;
    numeral.position.set(0, 0.004, 0.0402);
    numeral.userData.explodeWithParent = true;
    tab.add(numeral);
  }
  swap(meshes['tabs'], new RoundedBoxGeometry(0.62, 0.004, 0.086, 2, 0.0019));
  // The generator emits repetition systems as radial InstancedMesh stand-ins at the parent's centre
  // (its "section-tabs" cluster showed as a stray block mid-rail at 0.08 W tall). The real tabs are
  // components and the knurl is built above, so the stand-ins are hidden.
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh && !o.userData.handBuilt) o.visible = false;
  });
  // View switch knob: 0.035 × 0.07 × 0.04 with three grip ridges on its outer face.
  const knob = meshes['switch-view'];
  swap(knob, new RoundedBoxGeometry(0.035, 0.07, 0.04, 3, 0.008));
  if (knob) {
    for (const dy of [-0.016, 0, 0.016]) {
      const ridge = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.006, 0.03, 2, 0.0025), knob.material as THREE.Material);
      ridge.name = 'switch-grip';
      ridge.position.set(0.0185, dy, 0);
      ridge.userData.explodeWithParent = true;
      knob.add(ridge);
    }
  }
  swap(meshes['contact-card'], new RoundedBoxGeometry(0.86, 0.54, 0.02, 3, 0.008));

  // Recesses on the flat side bands (dark rounded-rect decals just proud of the face).
  const shellNode = nodes['shell'];
  const recessMat = new THREE.MeshBasicMaterial({ color: '#050506', polygonOffset: true, polygonOffsetFactor: -2 });
  const onSide = (m: THREE.Object3D, name: string, pos: THREE.Vector3, rotY: number) => {
    m.name = name;
    m.position.copy(pos);
    m.rotation.y = rotY;
    m.userData.explodeWithParent = true;
    shellNode?.add(m);
    return m;
  };
  const recess = (name: string, w: number, h: number, pos: THREE.Vector3, rotY: number) =>
    onSide(new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(w, h, Math.min(w, h) * 0.45), 8), recessMat), name, pos, rotY);
  const zMid = BODY.t / 2; // shell node frame spans z 0..t
  const L = -0.5 - 0.0004;
  const R = 0.5 + 0.0004;
  recess('roller-slot', 0.07, 0.27, new THREE.Vector3(L, 0.29, zMid), -Math.PI / 2);
  recess('switch-slot', 0.05, 0.19, new THREE.Vector3(R, 0.47, zMid), Math.PI / 2);

  // Side glyphs (engraved, 0.001 W decals): ▲ ▼ around the roller; device / list icons at the
  // switch's two ends (up = the 3D device view, down = the list view).
  const glyph = (name: string, shape: THREE.Shape | THREE.Shape[], pos: THREE.Vector3, rotY: number) =>
    onSide(new THREE.Mesh(new THREE.ShapeGeometry(shape, 4), glyphMat), name, pos, rotY);
  const tri = (up: boolean) => {
    const s = new THREE.Shape();
    const k = up ? 1 : -1;
    s.moveTo(0, 0.013 * k);
    s.lineTo(0.013, -0.009 * k);
    s.lineTo(-0.013, -0.009 * k);
    s.closePath();
    return s;
  };
  // On the −X face (rotY −π/2) shape +X points toward +Z, so the glyph's X is across the band.
  glyph('roller-arrow-up', tri(true), new THREE.Vector3(L, 0.29 + 0.165, zMid), -Math.PI / 2);
  glyph('roller-arrow-down', tri(false), new THREE.Vector3(L, 0.29 - 0.165, zMid), -Math.PI / 2);
  const deviceIcon = roundedRectShape(0.024, 0.034, 0.005);
  deviceIcon.holes.push(roundedRectShape(0.014, 0.018, 0.002, 0, 0.004) as unknown as THREE.Path);
  glyph('switch-icon-device', deviceIcon, new THREE.Vector3(R, 0.47 + 0.13, zMid), Math.PI / 2);
  glyph('switch-icon-list', [-0.009, 0, 0.009].map((y) => roundedRectShape(0.026, 0.0045, 0.002, 0, y)),
    new THREE.Vector3(R, 0.47 - 0.13, zMid), Math.PI / 2);

  // Card reader (DC-2): a deep dark mouth with a champagne lip, and a status LED above it that shares
  // the Confirm ring's emissive material, so one tween lights both.
  const slotMesh0 = meshes['card-slot'];
  if (slotMesh0) slotMesh0.visible = false;
  const slotLipShape = roundedRectShape(0.042, 0.594, 0.018);
  slotLipShape.holes.push(roundedRectShape(0.03, 0.58, 0.012) as unknown as THREE.Path);
  const slotLip = new THREE.Mesh(new THREE.ShapeGeometry(slotLipShape, 8), new THREE.MeshStandardMaterial({
    // Champagne (as the shared material, envMapIntensity 1.7) but with its own depth offset: it is a
    // decal 0.0004 W off the side face.
    color: '#e3c894', metalness: 1, roughness: 0.3, envMapIntensity: 1.7, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  onSide(slotLip, 'card-slot-lip', new THREE.Vector3(R, -0.02, zMid), Math.PI / 2);
  recess('card-slot-mouth', 0.03, 0.58, new THREE.Vector3(R + 0.0002, -0.02, zMid), Math.PI / 2);
  const readerLed = new THREE.Mesh(new THREE.CircleGeometry(0.008, 24), new THREE.MeshStandardMaterial());
  readerLed.userData.led = true; // refineMaterials swaps in the shared LED material
  onSide(readerLed, 'card-reader-led', new THREE.Vector3(R + 0.0002, 0.31, zMid), Math.PI / 2);

  // USB-C: stadium opening + tongue on the bottom face (replaces the generator's box).
  const port = meshes['port'];
  if (port) {
    port.visible = false;
    const portGroup = new THREE.Group();
    portGroup.name = 'usb-c';
    portGroup.position.set(0, -0.75 - 0.0004, zMid);
    portGroup.rotation.x = Math.PI / 2; // shape XY → faces −Y
    const opening = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(0.15, 0.04, 0.0199), 12), recessMat);
    const tongue = new THREE.Mesh(
      new THREE.PlaneGeometry(0.09, 0.012),
      new THREE.MeshStandardMaterial({ color: '#2b2c31', roughness: 0.4, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    portGroup.add(opening, tongue);
    shellNode?.add(portGroup);
  }

  // Lanyard slot: the keychain module's slot (bevel lip + dark opening) at the keychain-anchor socket.
  const slotMesh = meshes['lanyard-slot'];
  if (slotMesh) slotMesh.visible = false;
  sockets['shell:keychain-anchor']?.add(createLanyardSlot());

  // Back plate: raised D-star (0.3 W tall, champagne) and engraved studio name, both reading correctly from behind.
  const back = nodes['back-plate'];
  if (back) {
    const k = 0.3 / 89; // logo spans y 5..94 in its 100-unit box
    const logo = new THREE.Mesh(
      new THREE.ExtrudeGeometry(logoShapes([D_PATH, STAR_PATH]), { depth: 0.004 / k, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 2, curveSegments: 16 }),
      new THREE.MeshStandardMaterial({ color: '#e3c894', metalness: 1, roughness: 0.28 }),
    );
    logo.name = 'back-logo-emboss';
    // scale(k, −k, −k) is a 180° turn about X (two negative axes keep face winding): the SVG's y-down
    // mark reads upright from +Z and occupies z ∈ [−d, 0]. rotation.y = π then makes it read correctly
    // from behind and puts it in [0, d]; position.z = −d (+0.0005 embed) seats it on the plate's back face.
    logo.geometry.translate(-52, -49.5, 0).scale(k, -k, -k);
    logo.rotation.y = Math.PI;
    logo.position.set(0, 0.3, -0.004 + 0.0005);
    logo.userData.explodeWithParent = true;
    back.add(logo);

    const text = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.05),
      new THREE.MeshStandardMaterial({
        transparent: true,
        roughness: 0.6,
        color: '#8b8d96',
        alphaMap: textTexture('DEAN STUDIO', 1024, 102),
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    text.name = 'back-studio-text';
    text.rotation.y = Math.PI;
    text.position.set(0, -0.64, -0.0004);
    text.userData.explodeWithParent = true;
    back.add(text);
  }
}

export type GpuTier = 'high' | 'low';

/**
 * Material pass: the spec's designed CMF (materials[] in object-sculpt-spec.json, chosen in
 * lab/materials.html). The generator's MeshPhysicalMaterial ignores `physical.iridescence`, so it is
 * applied here. `low` tier swaps the thin-film shell for the graphite-satin fallback (variant C).
 */
export function refineMaterials(root: THREE.Object3D, tier: GpuTier = 'high', envMap: THREE.Texture | null = null): void {
  const { meshes } = runtimeOf(root);
  const shell =
    tier === 'high'
      ? new THREE.MeshPhysicalMaterial({
          name: 'shell-iridescent', color: '#2a2b31', metalness: 0.8, roughness: 0.3,
          iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 650], clearcoat: 0.5, clearcoatRoughness: 0.2,
        })
      : new THREE.MeshPhysicalMaterial({ name: 'shell-graphite', color: '#15161a', metalness: 0.35, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.35 });
  const back =
    tier === 'high'
      ? // Without a thickness map three.js renders the film at the range MAX, so the max sets the head-on
        // hue: 650/560 nm read green on the big back plate (material-pass renders). 380 nm sits in the
        // same mauve–violet family as the frame edge, and a weaker film keeps the plate graphite.
        new THREE.MeshPhysicalMaterial({
          name: 'back-satin', color: '#232429', metalness: 0.8, roughness: 0.42,
          iridescence: 0.5, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 380], clearcoat: 0.2, clearcoatRoughness: 0.4,
        })
      : new THREE.MeshPhysicalMaterial({ name: 'back-graphite', color: '#17181c', metalness: 0.35, roughness: 0.48 });
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'glass-black', color: '#0b0b0d', roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.6,
  });
  // E-ink reads identical under any light: unlit, not tone-mapped. CSS3D HTML draws the content.
  const paper = new THREE.MeshBasicMaterial({ name: 'eink-paper', color: '#e3ded1', toneMapped: false });
  // Metal shows its colour only through reflections: at envMapIntensity 1 the accents rendered as dull
  // bronze (mean sRGB 146,130,103 vs design #e3c894). 1.7 brings them back to a champagne read.
  const champagne = new THREE.MeshStandardMaterial({ name: 'champagne-metal', color: '#e3c894', metalness: 1, roughness: 0.24, envMapIntensity: 1.7 });
  const polymer = new THREE.MeshStandardMaterial({ name: 'key-polymer', color: '#26282f', roughness: 0.45, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ name: 'recess-dark', color: '#060607', roughness: 0.9 });
  const led = new THREE.MeshStandardMaterial({ name: 'led-emissive', color: '#e4cf9f', emissive: '#f2dfb6', emissiveIntensity: 0.15, roughness: 0.4 });
  const card = new THREE.MeshStandardMaterial({ name: 'card-matte', color: '#16171b', roughness: 0.8 });

  const set = (id: string, m: THREE.Material) => {
    const mesh = meshes[id];
    if (mesh) mesh.material = m;
  };
  set('shell', shell);
  set('back-plate', back);
  set('front-glass', glass);
  set('display', paper);
  set('key-confirm', champagne);
  set('roller', champagne);
  set('tab-01', champagne);
  for (const id of ['tab-02', 'tab-03', 'tab-04', 'key-back', 'switch-view']) set(id, polymer);
  // Surface-pass parts that share a material: the card reader LED is the Confirm ring's emissive (one
  // tween lights both); the switch grips follow the knob.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.led) m.material = led;
    if (m.name === 'switch-grip') m.material = polymer;
  });
  set('tabs', dark);
  set('confirm-led-ring', led);
  set('contact-card', card);
  const knurl = meshes['roller']?.getObjectByName('roller-knurl') as THREE.InstancedMesh | undefined;
  if (knurl) knurl.material = champagne;

  // Since three r163 a material lit by scene.environment gets scene.environmentIntensity, ignoring its
  // own envMapIntensity. Assigning the environment per material makes the per-material values
  // (champagne 1.7, glass 0.6) take effect.
  if (envMap) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial && !std.envMap) {
          std.envMap = envMap;
          std.needsUpdate = true;
        }
      }
    });
  }
  root.userData.materials = { shell, back, glass, paper, champagne, polymer, dark, led, card };
}

/**
 * Rest state (interaction defaults): the contact card is tucked away until the Contact section
 * slides it out, and tab 01 is the pressed/active tab.
 */
export function applyRestState(root: THREE.Object3D): void {
  const { nodes } = runtimeOf(root);
  const card = nodes['contact-card'];
  if (card) card.visible = false;
  // three.js raycasts ignore `visible`, so hidden generator stand-ins (the inserted key card sticks
  // 0.36 W out of the right side; the card-slot, port and lanyard planes; the repetition clusters)
  // would still catch clicks. Only visible parts, and the deliberate hit areas added by controls.ts,
  // take pointer input.
  root.traverse((o) => {
    let hidden = false;
    o.traverseAncestors((a) => (hidden ||= !a.visible));
    if ((hidden || !o.visible) && (o as THREE.Mesh).isMesh) o.raycast = () => {};
  });
}

/** White-on-black text mask sized to the plane's aspect (w:h), for alphaMap decals. */
function textTexture(text: string, w: number, h: number, o: { size?: number; spacing?: number } = {}): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')! as CanvasRenderingContext2D & { letterSpacing: string };
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(o.size ?? h * 0.6)}px ui-monospace, Consolas, monospace`;
  ctx.letterSpacing = `${Math.round(o.spacing ?? h * 0.28)}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** Flat engraved face on top of a key cap (cap mesh axis = local Y). */
function addCapFace(cap: THREE.Mesh | undefined, radius: number, topY: number, material: THREE.Material): void {
  if (!cap) return;
  const face = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), material);
  face.rotation.x = -Math.PI / 2; // circle faces +Y (the cap's outward axis)
  face.position.y = topY + 0.0002;
  face.name = `${cap.name}-face`;
  face.userData.explodeWithParent = true;
  cap.add(face);
}
