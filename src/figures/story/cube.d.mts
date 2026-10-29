// Types for cube.mjs (plain ESM, shared with the Node checks).
export declare const W: number;
export declare const H: number;
export declare const KZ: number;
export declare const MIDZ: number;
export declare const EDGE: number;
export declare const P: { origin: [number, number]; scale: number; azimuth: number; elevation: number };
export declare const PAD_AT: [number, number];
export declare const FACE_HALF: number;
export declare const FACE_D: string;
export declare const FACES: { matrix: string; light: number }[];
export declare const STICKER_D: string;
export declare const SHADOW_D: string;
export declare const BEAT: { rest: number; tumble: number; pop: number; hold: number; loop: number };
export type Mat3 = number[][];
export interface Cubie { id: number; pos: number[]; R: Mat3; st: { n: number[]; c: number; t: number[] }[] }
export interface Move { axis: number; layer: number; dir: number; t0: number; dur: number }
export interface Plan { moves: Move[]; turns: number; tiltA: number; tiltB: number; fa: number; fb: number; pa: number; pb: number }
export interface SolidPaths { fill: string; outline: string; crease: string; top: string; shades: string[] }
export interface CubieShape { id: number; key: number; paths: SolidPaths; stickers: ({ c: number; matrix: string; shade: number } | null)[] }
export declare function makeCube(): Cubie[];
export declare function applyMove(cubies: Cubie[], move: { axis: number; layer: number; dir: number }): void;
export declare function cubeShapes(cubies: Cubie[], Rg: Mat3, move: { axis: number; layer: number; dir: number } | null, theta: number, z0?: number): CubieShape[];
export declare function rotAxis(axis: number, a: number): Mat3;
export declare function planOf(n: number): Plan;
export declare function spinOf(p: Plan, t: number): Mat3;
export declare function twistOf(p: Plan, t: number): { move: Move; u: number } | null;
export declare function poster(): Cubie[];
export declare const REST: () => Mat3;
export declare function prng(seed: number): () => number;
export declare function staticBody(): string[];
export declare function iso3(p: number[]): [number, number];
