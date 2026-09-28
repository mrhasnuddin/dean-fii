// Dean Studio D-star monogram, from deanfi.svg (viewBox 0 0 100 100).
export const D_PATH =
  'M12 24c0 3 8 3 8 14v43c0 8-2 10-8 13h31c-7-3-9-5-9-13V31c22-1 39 10 43 28 3 15-6 28-25 35 27-5 40-20 37-39-2-14-12-24-26-28 2-2 3-4 4-7-5 4-12 4-24 4H12Z';
export const STAR_PATH = 'M80 5c2 9 3 10 12 12-9 2-10 3-12 12-2-9-3-10-12-12 9-2 10-3 12-12Z';
export const LOGO_PATHS = [D_PATH, STAR_PATH] as const;
/** Visual centre of the full mark inside its 100×100 box. */
export const LOGO_CENTER = { x: 52, y: 49.5 } as const;
export const LOGO_COLOR = '#f2dfb6';
