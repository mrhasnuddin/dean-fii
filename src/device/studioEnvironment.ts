// Dark product-studio environment for the site (lighting pass). RoomEnvironment is a bright grey room:
// it greys out black glass and flattens metal on a dark page. This is a black room with three HDR
// softboxes, so reflections read as crisp light bands on glass, foil and champagne metal.
import * as THREE from 'three';

function softbox(w: number, h: number, color: string, intensity: number, pos: [number, number, number], look: [number, number, number]) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
  );
  m.position.set(...pos);
  m.lookAt(...look);
  return m;
}

export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const room = new THREE.Scene();
  // A near-black room left metal with nothing to reflect between softboxes (key card read black at
  // most angles). A dim base plus a broad overhead panel keeps metal and foil alive; the page
  // background the visitor sees is separate and stays dark.
  room.background = new THREE.Color('#1c1d22');
  room.add(
    softbox(10, 10, '#ffffff', 0.9, [0, 6, 0], [0, 0, 0]), // overhead: broad, dim
    softbox(6, 3.2, '#ffffff', 5.5, [-4, 4.5, 5], [0, 0, 0]), // key: large, upper left front
    softbox(1.2, 7, '#b9a6ff', 3.2, [5.5, 0.5, -2], [0, 0, 0]), // rim: tall cool strip, right back
    softbox(8, 1.5, '#e8d2a4', 0.9, [0, -5, 2], [0, 0, 0]), // bounce: faint warm floor
    softbox(2.4, 2.4, '#ffffff', 2.2, [3, 3.5, 4.5], [0, 0, 0]), // fill: small upper right
  );
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.02).texture;
  pmrem.dispose();
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return env;
}
