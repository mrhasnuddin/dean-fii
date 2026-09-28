// Sound audition: every sprite with where the site plays it, plus the contact sequence's timing.
import { sfx, type SfxName, type PlayOptions } from '../audio/sfx';

type Row = { label: string; where: string; play: () => void };
const p = (name: SfxName, o?: PlayOptions) => () => sfx.play(name, o);
const semis = (n: number) => 2 ** (n / 12);

const rows: Row[] = [
  { label: 'tab 01 · 02 · 03 · 04', where: 'A section becomes active (scroll, tab click, keys 1–4). Pitch rises D E F♯ A.', play: () => [0, 2, 4, 7].forEach((s, i) => setTimeout(() => sfx.play('tab', { rate: semis(s) }), i * 260)) },
  { label: 'eink', where: 'Every full screen refresh (section change, contact states). Very quiet.', play: p('eink') },
  { label: 'tick', where: 'One list step: roller, wheel over the wallet, ↑/↓, row tap, detail pager.', play: () => [0, 1, 2, 3].forEach((i) => setTimeout(() => sfx.play('tick'), i * 90)) },
  { label: 'bump', where: 'Roller clicked at the end of a list. Also a failed email copy.', play: p('bump') },
  { label: 'key (✓)', where: 'Confirm key pressed on the wallet.', play: p('key') },
  { label: 'key (Back)', where: 'Back key pressed on the wallet (same key, pitched down).', play: p('key', { rate: 0.82 }) },
  { label: 'open', where: 'A detail panel opens, or a contact channel is opened.', play: p('open') },
  { label: 'close', where: 'A detail panel closes (Esc, Back, ✕, backdrop).', play: p('close') },
  { label: 'switch', where: 'Motion switch: the wallet’s side switch or the header pill.', play: p('switch') },
  { label: 'jingle', where: 'The keychain coin is clicked (scrolls to the top).', play: p('jingle') },
  { label: 'clink soft · hard', where: 'The swinging coin hits the wallet; volume follows the impact speed.', play: () => { sfx.play('clink', { volume: 0.3 }); setTimeout(() => sfx.play('clink', { volume: 1 }), 500); } },
  { label: 'boot', where: 'Sound switched on in the header.', play: p('boot') },
  { label: 'write', where: 'Email copied.', play: p('write') },
  {
    label: 'Contact sequence',
    where: 'whoosh 0 s → tap + e-ink 0.70 s → verified + swish + e-ink 1.75 s → write ×3 from 2.37 s, 80 ms apart.',
    play: () => {
      const at = (ms: number, f: () => void) => setTimeout(f, ms);
      at(0, p('whoosh'));
      at(700, () => (sfx.play('tap'), sfx.play('eink')));
      at(1750, () => (sfx.play('verified'), sfx.play('swish', { volume: 0.7 }), setTimeout(() => sfx.play('eink'), 100)));
      [2370, 2450, 2530].forEach((ms) => at(ms, p('write')));
    },
  },
  { label: 'swish (put away)', where: 'The key card leaves.', play: p('swish') },
];

const root = document.getElementById('root')!;
const status = document.createElement('p');
status.className = 'status';
const toggle = document.createElement('button');
toggle.type = 'button';
const sync = () => {
  status.textContent = sfx.enabled() ? 'Sound is on (the same setting as the site).' : 'Sound is off for this site.';
  toggle.textContent = sfx.enabled() ? 'Turn sound off' : 'Turn sound on';
};
toggle.addEventListener('click', () => sfx.set(!sfx.enabled()));
sfx.subscribe(sync);
sync();
root.append(status, toggle);

const list = document.createElement('ol');
for (const r of rows) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = `▶ ${r.label}`;
  b.addEventListener('click', r.play);
  const d = document.createElement('span');
  d.textContent = r.where;
  li.append(b, d);
  list.append(li);
}
root.append(list);
