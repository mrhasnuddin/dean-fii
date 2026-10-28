// The 3D engine as one lazy chunk (docs/device-design.md §55): everything that pulls in three.js, loaded by main.ts only when the
// device view is shown. A visitor who starts in the List view never fetches, parses or builds any of it until they ask for the
// device; the first switch loads it, and after that it stays (paused while the List view is up).
export { createStage } from './stage';
export { createChoreography, TABS } from './choreography';
export { createControls } from './controls';
export { createContactSequence } from './contactSequence';
export { createMemorySequence } from './memorySequence';
export { createPower } from './power';
export { createTips } from './tips';
export { createVolumePill, usePill } from './volumePill';
export { loadBakedEnvironment } from '../device/studioEnvironment';
