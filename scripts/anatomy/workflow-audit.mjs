// Anatomy audit for the workflow figure (docs/device-design.md §32): records the true shapes of the static
// parts and the cable, then runs the skill's checks (clearance, terminals, supports, folds, crowding).
// Run: node scripts/anatomy/workflow-audit.mjs --audit   (needs the anatomy skill installed)
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CABLE, P, SHAPES as S } from '../../src/figures/workflow/scene.mjs';

const A = await import(pathToFileURL(join(homedir(), '.claude/skills/anatomy/kit/audit.mjs')).href);
const R = A.recorder(P);
const add = (shape) => R.solid(shape);
add(A.slab(S.mat.plan, S.mat.z, S.mat.h, { name: 'stand.mat' }));
add(A.prism(S.dock.F, S.dock.poly, 0, S.dock.h, { name: 'dock.base' }));
add(A.prism(S.socketA.F, S.socketA.poly, ...S.socketA.s, { name: 'dock.socket' }));
add(A.prism(S.plugA.F, S.plugA.poly, ...S.plugA.s, { name: 'cable.plugA' }));
add(A.prism(S.body.F, S.body.poly, ...S.body.s, { name: 'handheld.body' }));
const { c, base, baseH, post, postH, cup, cupH } = S.stand;
add(A.cylinder(c[0], c[1], base, 0, baseH, { name: 'stand.base' }));
add(A.cylinder(c[0], c[1], post + 2.4, baseH, 2, { name: 'stand.collar' }));
add(A.cylinder(c[0], c[1], post, baseH + 2, postH - 2, { name: 'stand.post' }));
add(A.cylinder(c[0], c[1], cup, baseH + postH, cupH, { name: 'stand.cup' }));
add(A.disc(S.plugB.F, S.plugB.socket[0], S.plugB.socket[1], S.plugB.socket[2], { name: 'stand.socket' }));
add(A.disc(S.plugB.F, S.plugB.plug[0], S.plugB.plug[1], S.plugB.plug[2], { name: 'cable.plugB' }));
const h = S.cube.half;
add(A.box([S.cube.c[0] - h, S.cube.c[1] - h, S.cube.c[2] - h], [S.cube.c[0] + h, S.cube.c[1] + h, S.cube.c[2] + h], { name: 'cube' }));
R.route('cable', CABLE.points, CABLE.r, { limp: true, owner: 'cable', touch: ['stand.mat'] }); // it lies on the mat
A.auditOrExit(R, P, { apart: false, frames: [] });
