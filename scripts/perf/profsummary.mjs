// Prints where a CPU profile's time went: self time, and inclusive time per function (who the time sits under).
export function summarize(prof) {
  const node = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map(), incl = new Map();
  const name = (f) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  prof.samples.forEach((sid, i) => {
    const dt = (prof.timeDeltas[i] ?? 0) / 1000;
    const f = node.get(sid).callFrame;
    if (f.functionName === '(idle)') return;
    self.set(name(f), (self.get(name(f)) ?? 0) + dt);
    const seen = new Set();
    for (let p = sid; p; p = parent.get(p)) {
      const k = name(node.get(p).callFrame);
      if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); }
    }
  });
  const top = (m, n, skip = () => false) => [...m.entries()].filter(([k]) => !skip(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${String(Math.round(v)).padStart(6)} ms  ${k}`);
  console.log('self time:\n' + top(self, 8).join('\n'));
  console.log('inclusive:\n' + top(incl, 22, (k) => /^\((root|program|garbage)|^\(anon\) [^ ]+:1$/.test(k)).join('\n'));
}
