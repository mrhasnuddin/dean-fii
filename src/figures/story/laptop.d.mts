// Types for laptop.mjs (plain ESM, shared with the Node checks).
export declare const W: number;
export declare const H: number;
export declare const P: { origin: [number, number]; scale: number; azimuth: number; elevation: number };
export declare const SCREEN_LOCAL: { x: number; y: number; w: number; h: number; r: number };
export declare const ROUTE: number[][];
export declare function iso3(p: number[]): [number, number];
export declare function staticBody(): string[];
