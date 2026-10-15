// Types for model.mjs (plain ESM, shared with the Node checks).
export interface WorkflowStep { title: string; line: string; moves: number; subs?: string[] }
export type Move = [axis: 'x' | 'y' | 'z', quarters: number];
export interface Cubie { id: number; home: number[]; pos: number[]; rot: number[][]; stickers: number[] }
export declare const STEPS: WorkflowStep[];
export declare const MOVES: Move[];
export declare const MOVE_COUNT: number;
export declare function stepOf(made: number): { step: number; sub: number; start: number; end: number };
export declare function endOf(step: number): number;
export declare function cubeAt(made: number): Cubie[];
export declare function turn(cubies: Cubie[], move: Move): void;
export declare function isSolved(cubies: Cubie[]): boolean;
export declare function facing(cubie: Cubie, f: number): number[];
export declare function markable(cubies: Cubie[], made: number, taken?: Set<number>): { id: number; f: number }[];
