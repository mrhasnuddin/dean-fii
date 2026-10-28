// The parts of the anatomy kit's WebGL layer (gl.mjs, MIT) that TypeScript code calls.
export interface GlLayer { gl: WebGLRenderingContext; /** Sizes the canvas to its box (done on every draw unless autoFit is false). */ fit(): void; set(v: Record<string, unknown>): void; draw(v: Record<string, unknown>, time: number): void; clear(): void }
export declare function glCamera(P: unknown): unknown;
export declare function glLayer(o: { canvas: HTMLCanvasElement; fragment: string; view: [number, number]; camera: unknown; uniforms?: string[]; fixed?: Record<string, unknown>; maxRatio?: number; autoFit?: boolean; onError?: (log: string) => void }): GlLayer | null;
export declare function burst(age: number, rise: number, fall: number): number;
export declare function smooth(a: number, b: number, x: number): number;
export declare function settle(state: { x: number; v: number }, target: number, dt: number, seconds: number, calm?: boolean): boolean;
