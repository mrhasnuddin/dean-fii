# DeanFi device: design spec (draft for Dean's approval)

The one-page site is driven by a single 3D hardware wallet. The form factor is taken from the Ledger Nano Gen5 references (`references/wallet/`). Every change from that reference has a stated job, from the site structure (IA), from Contra's device, or from staying legally distinct. Nothing is decorative without a job.

Unit **W** = body width. Measured reference proportions come from `.img2threejs/analysis/image-analysis.md`.

## 1. What we keep from the reference (the part Dean likes)

| Trait | Reference | Ours | Why keep |
|---|---|---|---|
| Portrait slab | H = 1.50 W, radius ≈0.09 W | same | The form Dean likes; it reads as a phone-sized wallet |
| Big e-ink screen | ≈0.79 W × 1.07 W (≈3:4) | same, 3:4 | The screen *is* the site menu; the largest possible canvas |
| Deep glossy bezel and chin | chin ≈0.30 W | same | Room for physical keys |
| E-ink UI language | dashed rules, inverted selection, bottom action bar | same *grammar*, our own layouts | Crisp and cheap to render as HTML; very legible |
| Companion square card | recovery card | reused as the **contact card** | Gives Contact a physical payoff |

## 2. What we change, and why

| # | Change | Job (IA / interaction) | Contra equivalent | Also differentiates from Ledger |
|---|---|---|---|---|
| 1 | **Four section tabs on the top edge** (01–04) | Section switcher: Works, Chronicle, About, Contact. The active tab sits pressed-in and lit. Scrolling the page presses the matching tab. Clicking a tab scrolls to that section. | `top1–3` tabs | Ledger has nothing on the top edge |
| 2 | **Thumb roller on the left edge** (upper third), knurled champagne | Browse the list on screen: previous/next project or event. Also spins when you use arrow keys or touch, so it always shows the motion. | The big dial | Ledger has a flat side button |
| 3 | **Two chin keys**: large round **Confirm** (right, lit ring) + small round **Back** (left) | Confirm = open the selected item's popup, with hold-to-confirm and the ring filling. Back = close the popup or step back. | ACCEPT + RESET | Ledger has one pill key and a bracket logo on the chin |
| 4 | **Motion switch on the right edge** (where Ledger's side button sits) | Motion on/off, which DeanFi2 already has (`localStorage['dean-motion']`). | ON/OFF switch | New function in that position |
| 5 | **D-star logo** on the back plate and boot screen; no bracket mark anywhere | Brand | Contra's logo on the device | Removes the Ledger trademark |
| 6 | **Colour, materials and finish (CMF)**: **iridescent graphite** body (thin-film, mauve → teal as it turns); champagne accents (#f2dfb6 family) on the roller, Confirm key, active tab, card marks and charm; warm e-ink paper | The colour shift makes every scroll-driven rotation visible. Champagne carries the D-star logo colour. | Contra's purple accent | Ledger is monochrome black and grey |
| 7 | USB-C centred on the bottom edge | Realism only | none | Ledger's is off-centre |
| 8 | **D-star coin keychain** on a cable chain, hooked to a lanyard bar in a slot in the bottom edge, left of the USB-C port | Brand signature. Secondary physical motion: it swings behind every device move. Tapping the charm scrolls back to the top ("logo = home"). The best moment for sound. | none | Ledger has no lanyard point |

### Body finish (decided 2026-09-27, see `lab/materials.html`)
- **A · Iridescent graphite (chosen):** `MeshPhysicalMaterial` color `#2a2b31`, metalness 0.8, roughness 0.3, iridescence 1, IOR 1.8, thin-film 250–650 nm, clearcoat 0.5 / 0.2.
- **C · Graphite satin (automatic fallback):** color `#15161a`, metalness 0.35, roughness 0.42, clearcoat 0.3. Used when the GPU tier is low or iridescence would cost frames.
- B · heat-tint titanium: rejected. The rainbow banding is loud and competes with the screen.
- Iridescence depends on reflections, so the scene needs an environment map (PMREM from `RoomEnvironment`, or a small custom HDR later).

### Keychain: D-star coin on a cable chain (revised 2026-09-27; built in `src/device/keychain.ts`, lab `lab/keychain.html`)
| Part | Spec |
|---|---|
| Lanyard slot | Rounded-rect opening in the flat part of the bottom face at x = −0.30 W: 0.056 × 0.08 W, with a thin bevelled lip. A bar runs along X, 0.02 W above the face, inside the body. Front chin stays clean. |
| Cable links ×2 | Champagne metal. Wire 0.0075 W, end radius 0.026 W, pitch 0.06 W. Inner width 0.037 W > the largest wire each link carries, so links thread without touching. Link 0 wraps the bar. (Was ×4; shortened 2026-09-28 so the whole charm hangs inside the frame under the larger hero wallet.) |
| Jump ring | Torus R 0.03 W, wire 0.007 W. |
| Coin | Ø 0.28 W (≈15 mm at device scale; was 0.48 W, reduced 2026-09-28 so the charm stays secondary to the wallet). Raised rim, **milled/reeded edge** (130 ridges, same pitch), soldered bail (R 0.024 W) at 12 o'clock. **Front:** D-star engraved at the centre: recessed, bevelled walls, matte darkened fill in a polished field with an engraved border ring. **Back:** engraved star + "DEAN STUDIO" on an arc. Textures are generated at runtime from `deanfi.svg`'s paths (no image files). |
| Interlock rule | Neighbouring elements are turned 90° about the chain axis (bar ⟂ link 0 ⟂ link 1 … ⟂ jump ring ⟂ bail). With an even link count the coin faces front. Frames are parallel-transported down the chain, so links never flip roll. |
| Physics | Verlet chain (240 Hz substeps, no physics library): distance and bend limits (70°). Link 0 swings ≤45° along the bar and ≤15° front/back (slot clearance). Nodes from link 1's end down, and the coin, are kept outside the body box; link 0's end is left to the slot clamp (colliding it too made the clamp and the box fight and could lock the chain in an L along the bottom face). The coin's heading trails the device's heading on an underdamped spring, so it twists and settles after each turn. |
| Input | Tap or click the coin: flick and spin, jingle, scroll to top. |
| Reduced motion | Hangs still; still clickable. |
| Verified | Hook and coin close-ups, all scroll poses including the flip to the back, shake test: no chain-through-body or link intersection. No console errors. |

Rule for future changes: **a new control needs a job in the IA, or it doesn't ship.**

## 3. Parts list (each is a separate mesh so it can animate)

| Part | Motion | Trigger |
|---|---|---|
| `shell` (frame + back plate) | whole-device pose per section | scroll |
| `glass` | none (clearcoat) | none |
| `screen` (e-ink backing plane + CSS3D HTML) | content swap, e-ink refresh flash | every state change |
| `tab-01…04` | press along -Y by 0.01 W; active one lit | scroll / click / keys 1–4 |
| `roller` | rotate about Z, one detent per list step | wheel over device / arrows / drag |
| `key-confirm` + `led-ring` | press along -Z; ring fills over the hold | click-hold / Enter |
| `key-back` | press along -Z | click / Esc |
| `switch-motion` | slide along Y | click / motion toggle |
| `card` (separate group) | slides out from behind, rotates to face the camera | Contact section confirm |
| `keychain` (4 cable links → jump ring → coin) | verlet chain physics + coin twist | device motion / tap |

## 4. Screen system (360 × 480 CSS px, rendered with CSS3DRenderer)

- **Anatomy:** status bar (section name · position `03 / 10` · battery glyph), then content, then action bar (`‹ Back` · pager · `Hold ✓`).
- **Type:** a free monospace font for the UI, since Contra's PP Neue Montreal Mono is paid. Images are **dithered to 1-bit** on the screen and shown in full colour in the popup, as a deliberate reveal.
- **Idle (2026-09-28, `src/ui/pixelLogo.ts`):** the Hello screen is the D-star as 1-bit e-ink pixels (50 × 50 grid, 3 px dots) over a dashed rule and "Dean Studio". Every 3.2 s the sparkle twinkles (quarter turn while it breathes in, four glint dots), drawn as stepped 10 fps frames like e-ink partial refreshes. Any other screen falls back to the same mark after 25 s with no input anywhere (appears silently) and wakes on the next pointer move, key, wheel, scroll or touch (with the refresh swish). Reduced motion: the mark holds still.
- **States:** Boot (preloader) → Hello (hero) → Works list → Chronicle list (grouped CN / ID / MY) → About (portrait, tools, languages) → Contact (channel list: Email / LinkedIn / WhatsApp; the roller picks one, hold to confirm opens it, and the card slides out).
- All screen copy is placeholder until it goes through the `humanize` pass.
- **Dropped:** DeanFi2's About matching mini-game (REVAMP-HANDOFF.md §About) is not carried over. Dean's call, 2026-09-28.

## 5. Input mapping (every device control has a non-3D equivalent)

| Action | Device | Keyboard | Touch / phone |
|---|---|---|---|
| Switch section | top tabs | 1–4 | normal page scroll + tap tabs |
| Browse | roller | ↑ / ↓ | tap a list row on screen |
| Open | hold Confirm | Enter | tap the row a second time |
| Close | Back | Esc | ✕ in the popup / swipe down |
| Motion | right switch | none (header toggle) | header toggle |

The page scroll is **never** captured. The roller only responds to wheel input while the pointer is over the device, and scrolling at a list's end passes through to the page.

## 6. Contact details (owner-supplied; built in `src/ui/contactCard.ts`, lab `lab/card.html`)
| Channel | Shown as | Link | Behaviour |
|---|---|---|---|
| Email | `mr.hasn…@gmail.com` (name shortened, domain kept) | `mailto:` (same tab) | **Copy button** copies the full address, then shows ✓ plus "Email copied" (or a failure message) for 1.8 s |
| LinkedIn | `in/hasnuddin` | https://www.linkedin.com/in/hasnuddin/ (new tab) | |
| WhatsApp | `+60 12-*** 3743` (middle masked) | `https://wa.me/…` (number in `src/content/contact.ts`) (new tab) | Added by Dean on 2026-09-27; it isn't in REVAMP-HANDOFF.md |

- **Scraper protection:** email and phone are stored in parts (`src/content/contact.ts`). The real `mailto:`/`wa.me` hrefs are filled in on first hover, focus or touch, so the static HTML contains neither full value (verified). Anyone who clicks still gets a normal link. A determined scraper running a real browser can still get them; the goal is to stop bulk harvesting.
- **Accessibility:** hidden prefixes make the accessible names "Email: …", "LinkedIn: … (opens in a new tab)" and "WhatsApp: … (opens in a new tab)". They match the visible text, so voice control works. Tap targets are ≥32 px. Focus rings are champagne.
- The same live HTML is used as the 3D card's CSS3D face, the Contact popup and the list view.
- Section tabs use the numbers `01–04`.

## 6b. Portrait (About)
- Source: `dean 2.jpeg` (1254² stage photo). `scripts/media/portrait.py` builds:
  - `public/media/dean-portrait.webp`: colour **4:5 crop** (head to waist; keeps the mic and the gesture), 800×1000, for the popup and list view.
  - `public/media/dean-portrait-eink.png`: the same crop, contrast-lifted and **Floyd–Steinberg dithered to 1-bit** at 120×150 (one dot = one screen px), 2 KB, for the e-ink screen.
- The About screen's portrait frame is 4:5.

## 7. Sound design (Howler.js; built 2026-09-28, audition at `lab/sound.html`)

**Library:** Howler.js 2.2.x, the same library Contra uses. It handles sprites, Web Audio with an HTML5 fallback, mobile unlock and codec fallback. It is split into its own chunk (9.6 KB gzipped) and only imported on the visitor's first click, tap or key press, so no AudioContext exists before then.

**On/off (changed from the draft):** like Contra, sound is **on by default** with a header **Sound** pill next to Motion. The choice is saved in `localStorage['dean-sound']`. The draft's boot question ("Hold ✓ to enter with sound") was dropped: it would sit on the hero screen asking for an answer. Switching sound on plays the power-on sound as confirmation.
- Browsers block audio until the first gesture. Sounds requested before then are **dropped, not queued**, so they can't all fire at once on unlock. A sound requested by the unlocking gesture itself still plays if the file arrives within 350 ms.
- Nothing plays in a hidden tab. Reduced motion doesn't mute sound (sound isn't motion); in reduced motion the contact sequence plays only its "verified" chime and write ticks.
- Phones show the icon plus on/off; the label stays in the accessible name ("Sound on").

**Sources:** every sound is **synthesised from code** by `scripts/audio/build_sfx.py` (numpy + scipy, fixed seed; `--sheet` writes per-sound WAVs and a waveform and spectrogram review sheet to `.cache/sfx/`). There are no samples and no third-party licences. Each sound is modelled on the part that makes it; only the device's own feedback is tonal, in D major pentatonic, so the chimes agree with the tab pitches.

| Sprite | Model | Plays when | Level |
|---|---|---|---|
| `tab` | polymer tab on a metal dome | a section becomes active; **pitch rises 01 → 04 (D E F♯ A)** | −15 dBFS |
| `eink` | two faint swishes (matching the double flash) + crackle | every full screen refresh | −26 |
| `tick` | metal knurl detent | one list step: roller, wheel, ↑/↓, row tap, detail pager; ±4 % pitch, ≥45 ms apart | −21 |
| `bump` | dull end stop | roller clicked at a list end; failed email copy | −13 |
| `key` | round dome key, press + softer release | ✓ on the wallet; Back at rate 0.82 | −14 |
| `open` | struck tones D6 → A6 | a detail panel opens; a contact channel opens | −17 |
| `close` | low click + falling air | a detail panel closes | −20 |
| `switch` | friction, then detent snap | Motion switch (wallet or header) | −15 |
| `whoosh` | air noise shaped to the card's **speed curve** (power3.out 0.56 s, then power2.in into the tap) | key card entrance | −15 |
| `tap` | metal shell ring + card thump | the card meets the back plate (0.70 s) | −9 |
| `verified` | D6 F♯6 A6 + D7 sparkle | key read (1.75 s) | −14 |
| `swish` | short decaying air | card swings out; card put away | −18 |
| `write` | printhead step | each detail line written (80 ms apart); email copied | −22 |
| `jingle` | coin (free-plate mode ratios) + chain link ticks | coin clicked | −12 |
| `clink` | one coin hit + shell tick | the swinging coin hits the wallet body. `Keychain.takeImpact()` measures the inward speed in the body's frame; resting contact is ≈0.1–0.2 W/s, real hits 5–10 W/s; floor 0.45 W/s, volume follows the speed | −12 |
| `boot` | e-ink crackle, D5 → D6 | sound switched on | −14 |

**Size:** 7.8 s of sprite → `sfx.webm` 52 KB (Opus 48 kb/s) + `sfx.mp3` 61 KB fallback (Contra's is 442 KB). Sounds sit 120 ms apart and each entry has 40 ms of tail. Decoding both files back shows 0 samples of offset against the master and ≤0.8 % of any sound's energy outside its window.
**Rebuild:** `python scripts/audio/build_sfx.py` (needs ffmpeg: on PATH, `$FFMPEG`, or the winget Gyan.FFmpeg install, which it finds by itself). It rewrites `public/audio/sfx.*` and `src/audio/sprite.json`.

This is not legal advice. The changes above are meant to make the device clearly Dean's own design, not to guarantee that no trade-dress claim is possible.

## 8. Contact: NFC key tap (built 2026-09-27; superseded 2026-09-28 by the card reader, §10)

**Object:** Dean's key card (`src/device/keyCard.ts`), 0.81 × 0.81 × 0.02 W. It follows the recovery-key card language but uses Dean's branding.
- **Surface:** charcoal matte soft-touch (#2a2b30, roughness ≈0.86, faint sheen, seeded grain).
- **Marks:**
  - Four-point stars from the D-star mark, in stepped clusters at the top-left and bottom-right corners, reaching about ⅓ across.
  - Four larger stars frame the centre. These replace Ledger's bracket corners, which are its logo motif.
  - "DEAN STUDIO" is engraved at the top of the frame, where Ledger's slogan sits.
- **Back:** a debossed D-star; this is the side seen while the card is pressed to the wallet.
- **Details:** written inside the frame. The overlay is 240 × 128 px on 0.56 W, and its studio line is hidden because the studio name is already engraved.

**Visibility:** the card is **not in the viewport** until the visitor presses **Contact me**, or the wallet's own ✓ key, which the screen prompts for. "Put the key away" sends it back off-screen.

**Sequence** (`src/lab/contact.ts`, GSAP)

| Stage | Time | Motion | Screen (e-ink, CSS3D) |
|---|---|---|---|
| A prompt | none | Wallet only | "Contact Dean · Press ✓ and Dean's key will tap in" |
| B enter + approach | 0–0.7 s | Wallet turns its back (yaw −2.2). Card flies in from beyond the right edge (power3.out 0.56 s), flattens to the plate, then accelerates into the tap (power2.in 0.14 s, an impact) | none |
| C contact | 0.7 s | Card attaches. Recoil 2° and settle (back.out 2.5). LED flash. Keychain nudge | Refresh flash, then "Reading key…" |
| D reading | 0.95–1.7 s | Wallet turns back, card still pressed behind it | Stepped clip-path progress bar |
| E write | 1.75–2.6 s | Card swings out, faces the visitor, comes close (z 1.5) | "Key verified ✓" + channels |
| F ready | about 3 s | Details wipe in 80 ms apart; links, copy and masked WhatsApp all live | Roller picks a channel, ✓ opens it |
| Put away | 0.4 s | Card leaves the way it came (power2.out), wallet returns; faster than the entrance | Back to prompt |

**Rules**
- CSS3D surfaces are hidden when facing away from the camera or when their 3D parent is hidden.
- The label stays `inert` until written.
- The ✓ press snaps down in 60 ms and settles back in 160 ms.
- Reduced motion jumps straight to F with fades only: no flight, no recoil, no e-ink flash.

## 9. Page layout, loader and hero motion (2026-09-28, after Dean's review against Contra)

**Layout (Contra's corners):** brand top-left (light pill); **Share** (secondary: native share sheet on touch devices, otherwise copies the link) and **Work with Dean** (primary: scrolls to Contact and taps the key in) top-right; each section's big title bottom-left and its supporting text bottom-right; Sound and Motion bottom-right below that. Phones: brand shrinks to the mark, Sound/Motion become icon buttons beside it, Share becomes an icon; titles and text stack at the bottom. Text never takes pointer events (only real links and buttons do), so every key, the roller and the touch screen stay clickable where copy overlaps the wallet.

**Framing (`stage.ts`):** the wallet is centred and is the hero. Landscape: its body is 66 % of the viewport height, centred 40 % from the top, with the whole keychain inside the frame. Portrait: 80 % of the width, at most 55 % of the height, 36 % from the top. A soft violet-to-champagne radial glow sits behind it. Poses are rotations only: the hero is a three-quarter view from above (shows the top tabs and the roller edge); lists face front so the screen reads; About keeps its one full turn; Contact faces the incoming card, which settles in the free space to the right of the wallet (40 % of the height, smaller if it would cross the gutter). Phones bring the card in front.

**Cursor follow:** the wallet turns toward the mouse (±0.22 rad yaw, ±0.14 rad pitch, first-order damping, τ ≈ 250 ms) and floats slowly (0.012 rad, 0.018 W). It **holds still while the pointer is on the wallet or its screen**, so a key never drifts under the cursor. Off for touch, under reduced motion, and during the contact sequence (it settles in < 0.4 s, before the card lands).

**Loader (`index.html`, inline):** the D rises out of a mask like set type (760 ms, strong ease-out), the sparkle appears (from 0.5 scale + fade, slight overshoot), then twinkles (quarter turn + breath, 1.8 s cycle) until the page is ready. Transform/opacity only on separate elements, so it is composited and stays smooth while three.js is parsed and shaders compile. It is CSS rather than GSAP on purpose: it has to run before the 250 KB bundle arrives. It lifts after at least 1.35 s (the mark completes), once fonts, shader compile and the first frame are done (8 s cap). The wallet then rises and turns in underneath it (1.4 s expo out, most of the travel inside the 420 ms fade). Reduced motion: a still mark and a fade.

**Load cost measured (RTX 3060, ANGLE D3D11):** shader compile was the loader's wait: 13 programs, 3.85 s. Plain `MeshPhysicalMaterial`s without physical features (champagne, keychain, card edge, cap faces) became `MeshStandardMaterial` (identical at IOR 1.5; they now share programs), and the key card compiles in the background after the loader: 2.2 s. Repeat loads in the test browser were not faster, so no shader cache is assumed.

## 10. Button-driven site + device revision DC-2 (2026-09-28, Dean's review)

**Why:** the scroll storyline made the device's buttons redundant, and they were too small to hit (measured at 1440×900: top tabs 225–650 px², side switch 0–125 px², against a ~1,900 px² (44 × 44) target).

**Structure (Contra's model):** Hero → Console, and the page ends there. The footer was removed the same day at Dean's request: it cut the viewport in half and broke the device's frame (on phones, Share moved beside the Contact button). Scroll only moves between the Hero (three-quarter pose) and the Console (the wallet faces you, tipped back so the tabs read); if a scroll settles in between, it finishes the move in the direction it was going. In the Console the section is chosen by the wallet's top tabs, the on-page tab bar (an accessible `tablist`, and the thumb control on phones), keys 1–4, the screen's softkeys, or a deep link (`#/work`, `#/stage`, `#/contact`; detail links also select their section). The page title (bottom-left) and text (bottom-right) cross-fade with the section. Each section has a short device move (yaw 0.55 s, interruptible); About spins once per page view.

**Every control has a job:**

| Control | Job | Hit area now (1440×900) |
|---|---|---|
| Top tabs 01–04 (0.08 W tall, numerals engraved) | Works / Chronicle / About / Contact. The screen's top row labels each tab right under it (softkeys) | 2,880–4,300 px² |
| Roller (0.05 W proud, ▲▼ marks) | Browse the list | 4,656 px² |
| ✓ / Back | Open / close | 1,700–3,400 px² |
| Side switch (Device ↔ List icons) | List view (same as the bottom-right switch) | 3,680 px² |
| Card slot (right side, lip + reader LED) | The Contact payoff | — |
| Keychain coin (now Ø 0.17 W, the ✓ key's size; 2 links) | Back to the top | — |

Invisible hit boxes parented to the small controls give those areas; the nearest-hit rule keeps the glass and screen winning where they are in front. The wallet holds still while the pointer is on it.

**Card reader (Contact):** a blank key (bank-card ratio, 0.86 × 0.54 W) flies to the right-side slot as the wallet turns its reader toward you, slides in and latches (recoil, LED), the screen writes the details (printhead ticks), the card ejects on the reader's spring and floats out beside the wallet with the details written (phones: in front). Sounds: whoosh, insert, write ×4, eject, verified, swish. Put away 0.4 s.

**List view:** the whole portfolio as a plain page (works grid, chronicle, About, contact card), same routes; 3D paused. Chosen with the bottom-right Device / List switch or the wallet's side switch; remembered; automatic without WebGL.

**Preferences:** Sound and Motion are animated icon buttons. Sound: a level meter that breathes slowly and jumps while a sound plays; flat when off. Motion: a dot orbiting its ring (6 s); parked, ring dashed, when off. Both hold still when motion is off or reduced.

**img2threejs:** DC-2 is recorded in the spec (author_spec.py constants, card-slot component, switch-view, detail inventory, per-part surfaceDetail) and built as the surface pass (`src/device/generated/walletSurfacePass.ts` + walletRefine). Review recorded as request-input: Tier-1 IoU 0.9475, scale 0.012, multi-angle clean; aspect delta 0.052 > 0.05 is the approved taller tabs, and the per-part colour limit is the one already accepted on the material pass. The generator's radial repetition stand-ins are hidden (one showed as a block mid-rail).

**Copy (2026-09-28):** the About bio is Dean's own text, lightly edited for flow with nothing added: "UI/UX designer, frontend developer (vibe coding) and creative designer, focused on user interfaces, landing pages and frontend builds that are easy to understand." / "An experienced Web3 and blockchain speaker and presenter who also teaches Web3 topics." Site copy refers to Dean by name, never by pronoun.

## 11. Back stickers, a peelable easter egg (2026-09-28, Dean's request)

**What:** the three partner marks (`/OC.svg`, `/aseanlabs.svg`, `/mydac.svg`) are die-cut vinyl stickers on the wallet's back plate. Turn the wallet over by dragging its body sideways, then pull a sticker's corner. Built at runtime in `src/device/stickers.ts`; they are not part of the img2threejs spec (like the key card, they are props on the model, not the model).

**Random each visit:** position and tilt are random, with no overlap (a rotated-box test) and keep-out areas around the embossed D mark and the DEAN STUDIO line. A sticker shrinks to 90 % or 80 % to fit and is left off rather than overlapped. One random sticker rests with a corner already lifted: that is the hint.

**Look:** each sticker is cut from its SVG with a white or dark vinyl border (whichever contrasts with the print), and the outline is a holographic foil (iridescence + metal, driven by a packed map: R iridescence, G roughness, B metalness). A laminate clearcoat, fine grain, raised ink and two or three trapped air bubbles sit in a bump map. The back is a pale adhesive.

**Peel:** a page curl on a 48 × 48 grid. The corner nearest the grab lifts and rolls back over the sticker (it passes vertical as soon as it is pulled, so the adhesive side faces you; at 90° it would be edge-on and disappear), and the fold line follows the pointer at about half the pull, which keeps the tip near the finger. It stops at 70 % of the sticker, with resistance building toward the limit (rubber band). A soft shadow under the flap darkens with its height. Let go and it lays back down in 0.28 s (ease-out; instant under reduced motion) with a soft pat. Sounds: peel crackle while pulling, stick on landing. On touch, sideways pulls peel; vertical drags still scroll the page.

## 12. List view layout (2026-09-28, Dean's review)

About and Get in touch share one row, 60 / 40 (About left, the contact card right, keeping its card look): the contact details are three lines, and a full-width band left most of it empty. At 1440 the two columns are 482 and 449 px tall and the page is ~500 px shorter. Below 1180 px the portrait sits above the bio inside the 60 % column; below 760 px the two stack. Section numbers (01–04) were removed from the list view's headings and section links. The Console's tab bar keeps them, because they match the numerals engraved on the wallet's top keys.
