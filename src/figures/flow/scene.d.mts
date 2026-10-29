// Types for scene.mjs (plain ESM, shared with the Node checks).
export interface FlowScene {
  /** Stages drawn (1 to 9). */
  n: number;
  P: { origin: [number, number]; scale: number; azimuth: number; elevation: number };
  /** Screen pixels per world unit of height (a key's travel is a few of these). */
  KZ: number;
  body: string[];
  /** The screen vector of one world unit along y (the slider's thumb slides along it). */
  ay: [number, number];
  /** The thumb's centre at stage 0 and at the last stage, in screen units. */
  sliderA: [number, number];
  sliderB: [number, number];
  /** The thumb's world y at each stage. */
  slotY: number[];
  knobC: [number, number];
  /** The knob's angle (degrees, clockwise from up) at stage 0, and per stage. */
  knobBase: number;
  knobStep: number;
  /** Screen points along the cable, from the pad to the screen device. */
  pulse: [number, number][];
}
export declare const W: number;
export declare const H: number;
export declare const MAX_KEYS: number;
export declare const P: FlowScene['P'];
/** The screen's glass in its own units: width, height, and the unit vector down its slope. */
export declare const SCREEN: { w: number; h: number; down: number[] };
export declare function iso3(p: number[]): [number, number];
export declare function buildFlow(n: number): FlowScene;
