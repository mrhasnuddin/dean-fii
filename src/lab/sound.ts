// Sound audition: every sound effect with where the site plays it, the music switch, and the contact sequence's timing.
// Set 2 (docs/device-design.md §15). The music (§18) has its own switch below; both are the site's settings.
import { sfx, type SfxName, type PlayOptions } from '../audio/sfx';
import { music } from '../audio/music';

type Row = { label: string; where: string; play: () => void };
const p = (name: SfxName, o?: PlayOptions) => () => sfx.play(name, o);
const run = (steps: [number, () => void][]) => steps.forEach(([ms, f]) => setTimeout(f, ms));

const rows: Row[] = [
  { label: 'hover × 4', where: 'The mouse arrives on a wallet control or a tab (never on touch). 12 ms.', play: () => run([0, 1, 2, 3].map((i) => [i * 180, p('hover')])) },
  { label: 'press', where: 'Tabs (wallet, tab bar, keys 1–4), ✓, a detail panel opening, a contact channel. ~40 ms.', play: p('press') },
  { label: 'press (back)', where: 'Back, and a panel closing: the same press, pitched down.', play: p('press', { rate: 0.85 }) },
  { label: 'detent × 4', where: 'One list step: roller, wheel, ↑/↓, row tap, detail pager. Also email or link copied.', play: () => run([0, 1, 2, 3].map((i) => [i * 90, p('detent')])) },
  { label: 'toggle', where: 'Device/List and Motion switches; the key card seating in the reader; a sticker landing.', play: p('toggle') },
  { label: 'toggle (end stop)', where: 'The roller at a list end; a failed copy. Pitched down.', play: p('toggle', { rate: 0.8 }) },
  { label: 'coin tap · swing', where: 'The keychain coin clicked; the coin swinging into the wallet (quieter, follows the hit).', play: () => run([[0, p('coin')], [450, p('coin', { volume: 0.35 })]]) },
  { label: 'air', where: 'The key card flying in or out; the wallet settling after a hand turn.', play: p('air') },
  { label: 'peel', where: 'Peeling a sticker on the back (easter egg), while it lifts.', play: () => run([0, 1, 2].map((i) => [i * 130, p('peel', { volume: 0.5 + i * 0.2 })])) },
  { label: 'power', where: 'Sound effects switched on in the header.', play: p('power') },
  { label: 'success', where: 'The key comes back written: the one pitched sound (D6 + D7).', play: p('success') },
  {
    label: 'Contact sequence',
    where: 'air 0 s → toggle + process 0.83 s (seats, writes) → lighter toggle 1.83 s (eject) → success + air 2.19 s.',
    play: () =>
      run([
        [0, p('air')],
        [830, () => (sfx.play('toggle'), sfx.play('process'))],
        [1830, p('toggle', { rate: 1.25 })],
        [2190, () => (sfx.play('success'), sfx.play('air', { volume: 0.7 }))],
      ]),
  },
];

const root = document.getElementById('root')!;
const musicToggle = document.createElement('button');
musicToggle.type = 'button';
const syncMusic = () => (musicToggle.textContent = music.enabled() ? 'Turn music off' : 'Turn music on');
musicToggle.addEventListener('click', () => music.set(!music.enabled()));
music.subscribe(syncMusic);
syncMusic();
const status = document.createElement('p');
status.className = 'status';
const toggle = document.createElement('button');
toggle.type = 'button';
const sync = () => {
  status.textContent = sfx.enabled()
    ? 'Sound effects are on (the same setting as the site). The music is separate: its button is next to this one.'
    : 'Sound effects are off for this site.';
  toggle.textContent = sfx.enabled() ? 'Turn sound off' : 'Turn sound on';
};
toggle.addEventListener('click', () => sfx.set(!sfx.enabled()));
sfx.subscribe(sync);
sync();
root.append(status, toggle, ' ', musicToggle);

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
