// Types for scene.mjs (plain ESM, shared with the Node checks).
export declare const W: number;
export declare const H: number;
export declare const RISE: number;
export declare const KZ: number;
export declare const P: { origin: [number, number]; scale: number; azimuth: number; elevation: number };
export declare const ROUTES: Record<'crt' | 'ctl' | 'lite' | 'tun' | 'ship', [number, number, number][]>;
export declare const SHIP: [number, number][];
export interface GlPlane { o: number[]; u: number[]; v: number[]; n: number[]; half: [number, number, number] }
export declare const GL_DATA: { crt: GlPlane; phone: GlPlane; lite: GlPlane; ring: { c: number[]; z: number; half: [number, number, number] } };
export declare function sceneBody(): string[];
export declare function iso3(p: number[]): [number, number];
export declare const SOLIDS: Record<string, any>[];
