// The DeanFi wallet as the site uses it: the img2threejs-generated factory (surface pass, DC-2) plus the
// hand refinements recorded in the spec. Units: W (body width = 1), body centred on the root origin.
import * as THREE from 'three';
import { createDeanFiHardwareWalletModel } from './generated/walletSurfacePass';
import { applyRestState, refineForm, refineMaterials, runtimeOf, type GpuTier, type WalletRuntime } from './walletRefine';

export interface Wallet {
  root: THREE.Group;
  runtime: WalletRuntime;
  /** Keychain lanyard-bar anchor (X = bar axis). */
  keychainAnchor: THREE.Object3D;
  /** CSS3D screen socket: +Z out of the display, 0.795 W wide. */
  screenSocket: THREE.Object3D;
  /** Card reader mouth on the +X face (normal +X); the key card's short edge enters along −X. */
  cardSlot: THREE.Object3D;
  led: THREE.MeshStandardMaterial;
}

export function createWallet(opts: { tier?: GpuTier; envMap?: THREE.Texture | null } = {}): Wallet {
  const root = createDeanFiHardwareWalletModel();
  refineForm(root);
  applyRestState(root);
  refineMaterials(root, opts.tier ?? 'high', opts.envMap ?? null);
  const runtime = runtimeOf(root);
  return {
    root,
    runtime,
    keychainAnchor: runtime.sockets['shell:keychain-anchor'],
    screenSocket: runtime.sockets['display:css3d-screen'],
    cardSlot: runtime.sockets['shell:card-slot'],
    led: (root.userData.materials as { led: THREE.MeshStandardMaterial }).led,
  };
}
