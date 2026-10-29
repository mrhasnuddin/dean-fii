// Lab page for the story figures (lab/story.html): one figure alone, for the anatomy checks.
//   ?fig=problem|idea|flow   which figure
//   ?n=1&t=5.2               problem: freeze loop n at t seconds        idea: ?t=3
//   flow: ?stages=Ideation,Moodboard,MVPs  the stages   ?stage=2  presses one   ?still  no play by itself   ?w=900
//   ?w=560   the width
import '../styles/site.css';

const q = new URLSearchParams(location.search);
const fig = q.get('fig') ?? 'problem';
document.documentElement.style.setProperty('--w', `${q.get('w') ?? 560}px`);
const nav = document.getElementById('nav')!;
nav.innerHTML = ['problem', 'idea', 'flow'].map((f) => `<a href="?fig=${f}"${f === fig ? ' class="on"' : ''}>${f}</a>`).join('');
const host = document.getElementById('fig')!;

let handle: unknown;
if (fig === 'problem') {
  const { mountProblem } = await import('../figures/story/problem');
  const h = mountProblem(host);
  if (q.has('t')) h.seek(Number(q.get('n') ?? 0), Number(q.get('t')));
  handle = h;
}
if (fig === 'idea') {
  const { mountIdea } = await import('../figures/story/idea');
  const h = mountIdea(host);
  if (q.has('t')) h.seek(0, Number(q.get('t')));
  handle = h;
}
if (fig === 'flow') {
  const { mountKeypad } = await import('../figures/flow/live');
  const steps = (q.get('stages') ?? 'Ideation,Moodboard,MVPs,Iteration,Builds v1 to v3,Handover').split(',');
  const read = document.createElement('p');
  read.style.cssText = 'margin:10px 0 0;font:500 12px/1 system-ui;color:#e4cf9f';
  host.after(read);
  const h = mountKeypad(host, read, { steps }, { auto: !q.has('still') });
  if (q.has('stage')) h.hold(Number(q.get('stage')));
  handle = h;
}
Object.assign(window, { __fig: handle });
