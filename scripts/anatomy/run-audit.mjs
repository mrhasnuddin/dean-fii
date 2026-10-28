// Anatomy audit for the "How I work" instrument (docs/device-design.md §32): records the true shapes of the solids and the
// four cables, then runs the skill's checks (clearance, terminals, supports, folds, crowding).
// Run: node scripts/anatomy/run-audit.mjs --audit   (needs the anatomy skill installed)
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { P, ROUTES, SOLIDS } from '../../src/figures/run/scene.mjs';

const A = await import(pathToFileURL(join(homedir(), '.claude/skills/anatomy/kit/audit.mjs')).href);
const R = A.recorder(P);
for (const s of SOLIDS) {
  const meta = { name: s.name };
  if (s.kind === 'slab') R.solid(A.slab(s.plan, s.z, s.h, meta));
  else if (s.kind === 'cyl') R.solid(A.cylinder(s.c[0], s.c[1], s.r, s.z, s.h, meta));
  else if (s.kind === 'prism') R.solid(A.prism(s.F, s.poly, s.s[0], s.s[1], meta));
  else R.solid(A.disc(s.F, s.s[0], s.s[1], s.r, meta));
}
for (const [name, points] of Object.entries(ROUTES)) {
  if (name === 'ship') continue; // a groove on the mat, not a cable
  R.route(`cable.${name}`, points, 2, { limp: true, owner: `cable.${name}`, touch: ['stand.mat'] });
}
A.auditOrExit(R, P, { apart: false, frames: [] });
