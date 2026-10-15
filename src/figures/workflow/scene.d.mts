// Types for scene.mjs (plain ESM, shared with the Node checks).
import type { Cubie, Move } from './model.mjs';
export declare const W: number;
export declare const H: number;
export declare const P: { origin: [number, number]; scale: number; azimuth: number; elevation: number };
export declare const LCD: { x0: number; x1: number; y0: number; y1: number; r: number; depth: number };
export declare const CART_RISE: number;
export declare const CABLE: { r: number; points: [number, number, number][] };
export declare const GL_DATA: {
  lcd: { o: number[]; u: number[]; v: number[]; n: number[]; half: [number, number]; r: number };
  ring: { c: number[]; r: number };
  cube: number[];
};
export declare function sceneSvg(): { under: string };
export declare function cubeSvg(cubies: Cubie[], move?: Move | null, angle?: number, marks?: Map<number, { f: number; icon: number; on: boolean }>, lift?: { id: number; by: number } | null): string;
export declare function cartDown(by: number): string;
export declare function iso3(p: number[]): [number, number];
