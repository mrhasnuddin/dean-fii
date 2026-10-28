# Works restructure: top five and the archive cartridge (proposal, 2026-10-28)

Status: **steps 1 and 2 are built (2026-10-28, `device-design.md` §52); steps 3 to 5 are not.** ASEAN Labs is the fifth project. Dean asked for a blueprint after deciding that Works should show only the five best projects in full depth, with a "more projects" action that physically attaches a cartridge to the device before the screen loads the rest. About › "How I work with AI" comes after this is settled. Open decisions are at the end.

## 1. Why

- A visitor remembers three or four projects whatever they are shown. Eleven at equal weight lets the weakest one set the first impression.
- Two of the three Works pages are not pages: APPS holds one project (NARO) and MOTION is "coming soon". A coming-soon tab in the first view costs more than it gives.
- The device already teaches the idea that content arrives with a part: the memory card slots in, the screen loads a page, the card ejects (docs §34). The cartridge reuses that grammar.

## 2. Information architecture

| Tier | Projects | Treatment |
|---|---|---|
| Selected (5) | Kairma, FlowFi, Stashcube, NARO, ASEAN Labs | Full case study (see §6). Always on the screen. |
| Archive (6) | ENI Network, OpenCrew, PayGo, PUSC, Fortuna HK, Nikola | The existing panel (description, story, flow, stack). Shown only after the cartridge is docked. |

- **Fifth project.** ASEAN Labs is the recommendation: solo-built, the most authorship of the non-flagships, a strong visual identity. ENI is the alternative (name recognition, but the work was part of a team). Swapping is one data change.
- **Flagship star.** Promote the fifth project to `flagship: true` so the star means "case study" and matches the five. Archive rows get no star.
- **Tabs.** Remove the WEB / APPS / MOTION pills. NARO is listed with a "Mobile app" tag. Motion leaves Works until reels exist, then returns as a second cartridge (REELS) in the same bay.
- **Data.** (Built as a single `rank` per work; the first five are selected.) Was: add `tier: 'selected' | 'archive'` and an order; `worksPage` in `screen.ts` becomes `'selected' | 'archive'` (was `'web' | 'apps' | 'motion'`). `flipWorks` keeps driving everything.
- **Deep links.** `#/work/<archive id>` must open with the cartridge already docked and no animation, so shared links and the sitemap keep working.

## 3. Screens

- **Selected.** Status strip `Works · selected 5`; five rows; a teal ghost row under them, "View more…", subtitle listing three names ("ENI, OpenCrew, PayGo +3") so the archive is never a black box. Footer: Back, `1 of 5`, Open.
- **Archive.** Strip `Archive ▮ 6 projects` with a filled cartridge glyph; six rows; footer: Eject, `1 of 6`, Open.
- **List view (no 3D).** Five large cards, then a collapsed "More projects +6" row that expands the other six. No cartridge, no motion; same routes.
- **Leaving.** Back key, leaving the Works tab, Reset (pinhole) and the cartridge's own pull-tab all eject. This matches how the Motion card behaves today.

## 4. The cartridge

Where it goes was decided by elimination against the current device (body W 1 × H 1.5 × T 0.22):
- Top edge: the tab strip is 0.62 W wide and centred, which leaves 0.19 W each side. No room.
- Left edge: Motion switch, knob, battery window, Sound switch. Right edge: the Contact reader and the view switch.
- Back: the stickers, and it is invisible from the front, where the state has to read.
- Bottom: USB-C (x 0), the memory-card slot (x −0.3) and the reset pinhole (x +0.3). The slot is free once Motion leaves Works, so the cartridge takes it.
- The USB-C port itself was rejected as the attach point: it belongs to the cable (click to unplug, battery LEDs), and sharing it would couple two features.

| | Memory card today | Archive cartridge |
|---|---|---|
| Size (W) | 0.21 × 0.29 × 0.02 | 0.30 × 0.30 × 0.06 |
| Inside the body | 0.16 | 0.16 (0.14 stays out) |
| Slot centre x | −0.30 | −0.29 |
| Label | MOTION, play mark | ARCHIVE, "6 projects", gold contacts, three grip grooves |

Clearances at x −0.29: the cartridge spans −0.44 to −0.14, with the lip −0.457 to −0.123, which leaves about 0.04 W to the plug boot (±0.085) and 0.043 W to the body edge. Sizes are a first pass to tune by eye.

**Attach: mechanical dock, NFC handshake.** The cartridge docks into the bay with magnets, then an NFC ping (two dashed rings on the bottom face) and a status LED confirm it. This keeps both of Dean's ideas: a physical part, plus a wireless "read".

## 5. Choreography (motion on; about 1.7 s)

| Phase | Time | What happens |
|---|---|---|
| Press | 0 | The insert row or the "More projects" button is pressed. |
| Approach | 420 ms | The cartridge rises from below the frame along a short curve, ease-out. |
| Ping | 140 ms | It hovers under the bay; two rings pulse; the LED goes amber; the screen shows "Cartridge detected". |
| Dock | 160 ms | It seats with a spring recoil and a click; the LED goes green; the battery LEDs dip and recover (the cartridge draws power). |
| Read | 380 ms | The screen shows "Reading cartridge…" with a progress bar. |
| Print | 600 ms | The archive rows print one by one (60 ms stagger), header changes to Archive. |

- **Eject.** 180 ms spring out, then the cartridge drops away; the screen swaps back at once. Insert is the deliberate action and eases; eject is a system response and snaps.
- **Skippable.** (Not built: the sequence runs through, about 1.5 s in a foreground tab.)
- **Reduced motion or Motion off.** The cartridge is simply in; the screen swaps; no ring animation. A keyboard-initiated insertion (→, Enter on the View more… row) plays the sequence like the Contact card does; only deep links and reduced motion skip it.
- **Sound.** Reuse the existing insert and eject effects; respects the Sound setting.
- **Phones.** The bottom edge is mostly out of frame in the Console on a phone (docs §34), so the stage nudges up while the cartridge is in. Not checked on a real device.
- **Announcements.** `aria-live`: "Archive cartridge inserted. Six more projects." and the reverse on eject.

## 6. Case-study template for the five (needs Dean's material)

1. Meta strip: role, team, timeline, status.
2. One-line outcome.
3. Problem and constraints.
4. Two or three key decisions, each with what was considered, what was chosen and why, plus a visual.
5. Why this look (already written for all eleven).
6. Process artifacts: one picture and one sentence per stage chip in the Design flow (the diagram already reports the picked stage).
7. How it was built, including what the AI did and what was decided by hand.
8. Outcome and reflection.

Data sketch: an optional `case` on `Project` with `meta`, `decisions[]`, `artifacts` (stage to image and note), `outcome`, `reflection`.

## 7. Build order

1. **Data and IA.** `tier`, order, new `worksPage` values, the ghost row, the archive page, List view split, deep links. No new 3D.
2. **Cartridge on the existing card.** Re-skin the memory card as the ARCHIVE cartridge in `memoryCard.ts`, wire `worksPage: 'archive'` into `memorySequence.ts`, sounds, announcements, reduced motion.
3. **Hardware upgrade.** The wider bay, chunkier body, NFC rings, status LED, battery dip, phone nudge.
4. **Case studies.** Template first (Kairma as the pilot), then the other four, as Dean supplies artifacts.
5. **About › How I work with AI.** After the Works restructure.

## 8. Open decisions

- ~~The fifth project and the star~~: decided. ASEAN Labs; the star means "selected".
- The button wording. Options: "More projects" (clearest), "Open the archive", "Insert cartridge" (playful, obscure). Recommendation: the button says "More projects (6)", the aria label says "Insert the archive cartridge", the device row says "View more…".
- Whether to ship step 1 and 2 first and judge by eye before step 3.
- Client confidentiality for process artifacts, before any are collected.
