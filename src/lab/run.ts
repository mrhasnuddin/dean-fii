// Lab page for the "How I work" figure (lab/run.html): the figure alone, with a button per step, for the anatomy checks.
//   ?s=2&u=1&t=3.2  freezes a stop at a moment    ?gl=0  no WebGL (the SVG pulse)    ?calm=1  as if Motion were off
import '../styles/site.css';

const q = new URLSearchParams(location.search);
if (q.get('gl') === '0') HTMLCanvasElement.prototype.getContext = (() => null) as never;
if (q.get('calm') === '1') document.documentElement.classList.add('motion-off');
const { mountRun } = await import('../figures/run/live');

const nav = document.getElementById('nav')!;
const handle = mountRun(document.getElementById('fig')!, {
  onStep: (step, sub) => {
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === `${step}.${sub}`));
  },
});
const stops: [string, number, number][] = [['0 brief', 0, 0], ['1 ideation', 1, 0], ['2.0 skills', 2, 0], ['2.1 system', 2, 1], ['2.2 motion', 2, 2], ['2.3 prompting', 2, 3], ['3 prototype', 3, 0], ['4 iteration', 4, 0], ['5 ship', 5, 0]];
nav.innerHTML = [...stops.map(([label, s, u]) => `<button type="button" data-k="${s}.${u}" data-s="${s}" data-u="${u}">${label}</button>`), '<button type="button" data-s="-1">let go</button>'].join('');
nav.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (b) handle.hold(Number(b.dataset.s), Number(b.dataset.u ?? 0));
});
if (q.has('s')) handle.seek(Number(q.get('s')), Number(q.get('u') ?? 0), Number(q.get('t') ?? 0));
Object.assign(window, { __run: handle });
