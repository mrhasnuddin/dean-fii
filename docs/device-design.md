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
| 1 | **Four section tabs on the top edge** (01–04) | Section switcher: Works, Events, About, Contact. The active tab sits pressed-in and lit. Scrolling the page presses the matching tab. Clicking a tab scrolls to that section. | `top1–3` tabs | Ledger has nothing on the top edge |
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
- **States:** Boot (preloader) → Hello (hero) → Works list → Events list (grouped CN / ID / MY) → About (portrait, tools, languages) → Contact (channel list: Email / LinkedIn / WhatsApp; the roller picks one, hold to confirm opens it, and the card slides out).
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
| WhatsApp | `@0xDeann` (username) | `https://wa.me/0xDeann` (new tab) | Added by Dean on 2026-09-27; switched from the phone number to the WhatsApp username on 2026-09-28, so no number is published |

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

**Superseded by set 2 (§15), 2026-09-28.** The library, on/off, unlock and build pipeline below still hold; the sound list does not.

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
| Top tabs 01–04 (0.08 W tall, numerals engraved) | Works / Events / About / Contact. The screen's top row labels each tab right under it (softkeys) | 2,880–4,300 px² |
| Roller (0.05 W proud, ▲▼ marks) | Browse the list | 4,656 px² |
| ✓ / Back | Open / close | 1,700–3,400 px² |
| Side switch (Device ↔ List icons) | List view (same as the bottom-right switch) | 3,680 px² |
| Card slot (right side, lip + reader LED) | The Contact payoff | — |
| Keychain coin (now Ø 0.17 W, the ✓ key's size; 2 links) | Back to the top | — |

Invisible hit boxes parented to the small controls give those areas; the nearest-hit rule keeps the glass and screen winning where they are in front. The wallet holds still while the pointer is on it.

**Card reader (Contact):** a blank key (bank-card ratio, 0.86 × 0.54 W) flies to the right-side slot as the wallet turns its reader toward you, slides in and latches (recoil, LED), the screen writes the details (printhead ticks), the card ejects on the reader's spring and floats out beside the wallet with the details written (phones: in front). Sounds: whoosh, insert, write ×4, eject, verified, swish. Put away 0.4 s.

**List view:** the whole portfolio as a plain page (works grid, events, About, contact card), same routes; 3D paused. Chosen with the bottom-right Device / List switch or the wallet's side switch; remembered; automatic without WebGL.

**Preferences:** Sound and Motion are animated icon buttons. Sound: a level meter that breathes slowly and jumps while a sound plays; flat when off. Motion: a dot orbiting its ring (6 s); parked, ring dashed, when off. Both hold still when motion is off or reduced.

**img2threejs:** DC-2 is recorded in the spec (author_spec.py constants, card-slot component, switch-view, detail inventory, per-part surfaceDetail) and built as the surface pass (`src/device/generated/walletSurfacePass.ts` + walletRefine). Review recorded as request-input: Tier-1 IoU 0.9475, scale 0.012, multi-angle clean; aspect delta 0.052 > 0.05 is the approved taller tabs, and the per-part colour limit is the one already accepted on the material pass. The generator's radial repetition stand-ins are hidden (one showed as a block mid-rail).

**Copy (2026-09-28):** the About bio is Dean's own text, lightly edited for flow with nothing added: "UI/UX designer, frontend developer (vibe coding) and creative designer, focused on user interfaces, landing pages and frontend builds that are easy to understand." / "An experienced Web3 and blockchain speaker and presenter who also teaches Web3 topics." Site copy refers to Dean by name, never by pronoun. **2026-10-07:** "vibe coding" / "AI-assisted workflows" became **AI-native designer who also ships the frontend (no handoff between design and build)**, in the About bio and roles, the Hero and List view intro, the page title, meta/Open Graph/Twitter descriptions, the JSON-LD and the web manifest. Spelling: "AI-native" (hyphenated) in sentences; the About role label is "AI Native UI/UX Designer" (no hyphen, brand style). Per-project role tags are unchanged.

## 11. Back stickers, a peelable easter egg (2026-09-28, Dean's request)

**What:** the three partner marks (`/OC.svg`, `/aseanlabs.svg`, `/mydac.svg`) are die-cut vinyl stickers on the wallet's back plate. Turn the wallet over by dragging its body sideways, then pull a sticker's corner. Built at runtime in `src/device/stickers.ts`; they are not part of the img2threejs spec (like the key card, they are props on the model, not the model).

**Random each visit:** position and tilt are random, with no overlap (a rotated-box test) and keep-out areas around the embossed D mark and the DEAN STUDIO line. A sticker shrinks to 90 % or 80 % to fit and is left off rather than overlapped. One random sticker rests with a corner already lifted: that is the hint.

**Look:** each sticker is cut from its SVG with a white or dark vinyl border (whichever contrasts with the print), and the outline is a holographic foil (iridescence + metal, driven by a packed map: R iridescence, G roughness, B metalness). A laminate clearcoat, fine grain, raised ink and two or three trapped air bubbles sit in a bump map. The back is a pale adhesive.

**Peel:** a page curl on a 48 × 48 grid. The corner nearest the grab lifts and rolls back over the sticker (it passes vertical as soon as it is pulled, so the adhesive side faces you; at 90° it would be edge-on and disappear), and the fold line follows the pointer at about half the pull, which keeps the tip near the finger. It stops at 70 % of the sticker, with resistance building toward the limit (rubber band). A soft shadow under the flap darkens with its height. Let go and it lays back down in 0.28 s (ease-out; instant under reduced motion) with a soft pat. Sounds: peel crackle while pulling, stick on landing. On touch, sideways pulls peel; vertical drags still scroll the page.

## 12. List view layout (2026-09-28, Dean's review)

About and Get in touch share one row, 60 / 40 (About left, the contact card right, keeping its card look): the contact details are three lines, and a full-width band left most of it empty. At 1440 the two columns are 482 and 449 px tall and the page is ~500 px shorter. Below 1180 px the portrait sits above the bio inside the 60 % column; below 760 px the two stack. Section numbers (01–04) were removed from the list view's headings and section links. The Console's tab bar keeps them, because they match the numerals engraved on the wallet's top keys.

## 13. Phone pass (2026-09-28, Dean's review on a real phone)

**Found at 375 × 812:** the wallet's top keys sat under the header buttons; the Console tab bar covered the bottom of the ✓ and Back keys; the Back key was 36 px; the keychain hung over the tab bar and title; an 86 px gap sat under the title (every panel reserved the About bio's height); keyboard hints showed on touch; the screen's rows were 21 px and its "‹ Back" / "Open ✓" labels could not be tapped.

**Framing (stage.ts):** portrait is laid out in pixels. The top keys start under the header, and the body plus the keychain end above the Console copy (phones: 78 px top, 196 px copy; portrait tablets: 92 / 280). Short phones keep the wallet at least 62 % of the width (up to 240 px), and there the coin tucks behind the title. On phones the Hero wallet starts at 90 % and grows to full size on the way into the Console, because the Hero's copy is taller.

**Header (phones):** the brand, then Device/List + Sound + Motion in one capsule, then "Work with Dean", all 40 px tall.

**Console (phones and portrait tablets):** the title, then the text, then the tab bar last, where the thumb is. The tab bar never moves; the text above it takes the active section's height. Tabs are 44 px. On phones About shows the bio's second line with "Read about Dean" inline (the first line is close to the Hero's), and Contact shows its first sentence with "Contact me" and "Share" as a matched pair of 45 px buttons. Keyboard hints are hidden on touch. The detail sheet's backdrop is darker on phones.

**Touch targets on the wallet:** tab hit boxes 0.16 W (≥ 44 px), a 0.17 W ball around the Back key (49 × 57 px), the side switch's box grows outward. On touch screens the device screen shows 5 taller rows (28 px; the image well gives up 26 px), 30 px key labels, and softkeys with an invisible tap margin. "‹ Back" and "Open ✓" along the screen's bottom edge now press their keys. While the idle logo is up, the first tap wakes the screen (it covers the list, so the tap has nothing to act on).

**Measured after:** 375 × 812: keys start at y 69 (header ends 54), keychain ends 17 px above the title. 430 × 932: tabs 58 × 60 px. 768 × 1024: keychain ends 36 px above the title. 1440 × 900: unchanged.

## 14. Loader = the idle twinkle; keychain clink fix (2026-09-28, Dean's phone test)

**Loader:** it now plays the wallet screen's idle animation, smooth instead of in e-ink steps. The mark fades in (450 ms). Then, every 3.2 s, the sparkle turns a quarter while it breathes in to 58 % and back, and four glints flash on its diagonals (0.9 s), then it rests. The curves are the idle's (turn easeInOutCubic, breath sine), and the values match it frame for frame. The old loader had a rising D, a pop and a 1.8 s turn with a stop at 45°: CSS restarts a keyframe's easing at every stop, so the turn halted halfway. Turn, breath and glints are now separate elements with one curve per phase. The minimum loader time (1.35 s) is the fade-in plus one full twinkle.

**Keychain on phones:** the coin could chatter against the body and clink over and over. Collision pushed a node out of the body but kept its speed into it (Verlet velocity = pos − prev), so it bounced off, the chain pulled it back and it hit again. Janky phone frames made it worse: every sub-step of a long frame used the body's end pose, so the body seemed to slam into the chain. Now contact is inelastic (the speed into the face goes too), the body moves through the sub-steps like the anchor does, a clink needs the coin to have been off the body for 0.15 s, and clinks are at least 300 ms apart. Replayed with phone-like frame times, a coin resting on the body went from 177 hits in 8 s to 2, and the About spin from 27 to 6 (one per swing).

## 15. Sound set 2: fewer, shorter, one family (2026-09-28, Dean: "just like Contra's")

**What Contra does (measured from its sprite and code, for reference only; none of its audio is used):** eight sounds. Interaction sounds are 10–45 ms and not pitched: a hover tick (~3.2 kHz, mouse only), a press click (low body plus a broadband snap), a bright ratchet for list steps and the dial, and a low thock for toggles and errors. Pitch is kept for one reward, a bell ping an octave apart with a soft 80 ms attack. Two long textures (a screen power-up hum, a faint high "calculating" shimmer) mark processes, and a warm low drone loops under everything at 30 % volume. Set 1 had twenty sounds, pitched tabs and chimes, and interaction sounds of 40–700 ms, which is where it felt busy.

**Set 2 (`scripts/audio/build_sfx.py`, all synthesised, in D):**

| Sound | Character | Plays when |
|---|---|---|
| `hover` | 15 ms tick, ~3 kHz | the mouse arrives on a wallet control or a tab-bar tab (never on touch) |
| `press` | ~30 ms click: small low body, knock and snap | tabs (wallet, tab bar, keys 1–4), ✓, a panel opening, a contact channel; Back and a panel closing at rate 0.85 |
| `detent` | 10 ms bright tick | one list step (roller, wheel, ↑/↓, row tap, pager); email or link copied |
| `toggle` | 60 ms soft thock | Device/List and Motion switches; card seats (rate 1) and ejects (1.25); sticker lands; end stop and failed copy (0.8) |
| `process` | 0.9 s faint high shimmer | the reader writing the key |
| `success` | 1.3 s bell, D6 under a brighter D7, 50 ms attack | the key comes back written: the only pitched sound |
| `power` | 1.8 s warm swell in D | sound switched on |
| `air` | 0.28 s soft swish | the card flying in or out; the wallet settling after a hand turn |
| `coin` | 0.14 s short metal tick | the coin clicked; the coin swinging into the wallet (quieter, follows the hit) |
| `peel` | 0.18 s soft crackle | peeling a sticker |
| ~~`bed`~~ | *Replaced by the lo-fi music, §18: a drone under a real track would muddy it.* | |

The e-ink refresh is silent now (the press that caused it already sounded). A press arriving twice for one action (the key, then the panel it opens) is played once (70 ms throttle).

**Size:** `sfx.webm` 34 KB (was 52 KB).

**Audition:** `lab/sound.html` (every sound, where it plays, and the contact sequence at its real timing; the bed runs underneath).

## 16. Local time and battery on every screen (2026-09-28; every screen from 2026-10-01, Dean's request)

Every screen now starts the same way: the four softkeys (01–04) directly under the wallet's tab keys, the active one inverted with a caret up to its key (the key row no longer repeats the section's name), then a status strip: the page name on the left (HELLO, WORKS, EVENTS, ABOUT, CONTACT), and on the right Dean's local time, 24-hour, with the zone ("22:29 GMT+8", Malaysia, `Asia/Kuala_Lumpur`, no daylight saving) and the battery. Hello shows the same two rows, and so does the idle Standby overlay (which covers any section after 25 s without input, like a lock screen, labelled "STANDBY"). The clock changes in place on the minute, with no refresh flash.

The extra strip costs 26 px, so the picture strip above the Works and Events lists went from 150 to 138 px (100 px on touch screens, where the five rows are taller). All five lists fit above the footer with room to spare, desktop and touch.

## 17. Addresses (2026-09-28)

The address bar stays the plain site address. In-page links (the logo, the skip link, List view's section links) scroll without writing `#hello`, `#console` or `#lv-…` into it, and section links from outside (`…/#/contact`, `#/work`, `#/stage`) open their section and then tidy back to the plain address. Only an open detail panel shows a hash (`#/work/eni`, `#/stage/…`, `#/about`): it makes the panel shareable, and Back closes it. Links to panels that don't exist are tidied away. Share always copies the plain address.

## 18. Background music: lo-fi café, polished for a product showcase, with its own switch (2026-10-01, Dean's request)

**Version history, from Dean's feedback.** v1 was lo-fi with a drum kit: the beat sounded like a real drum and was too present. v2 was a calm electronic track with no drums: it didn't match the site's vibe. v3 (this) is "lo-fi café, or lo-fi product showcase": the lo-fi harmony of v1 with a soft electronic beat, a clean, quiet finish and a music-box sparkle.

**The track (`scripts/audio/build_music.py`, composed and rendered from code; nothing sampled):** 16 bars at 76 BPM (50.5 s), lightly swung (56 %), in D major.
- **Keys:** a warm Rhodes-style electric piano on jazzy rootless chords (Dmaj9 Bm9 Gmaj9 A7, F♯m9 Bm9 Em9 A13, then a variation), strummed a little off the grid, with slow auto-pan and chorus.
- **Bass and melody:** a soft bass on the roots (kept between D2 and B2: warm and audible, not rumble) and a sparse music-box melody through a dotted-8th ping-pong echo.
- **The beat is electronic and soft, nothing like a real kit:** a round sine thump with no beater click (beat 1, the "and" of 2, and a third on alternate bars), a muted finger-snap where a snare would be (a woody ping and a puff of air, no rattle, laid back 12 ms), and a swelling shaker instead of a hi-hat. The keys and bass dip a little with each thump.
- **Finish:** tape warmth (slow wobble, gentle saturation, a roll-off above 7.6 kHz), only a trace of vinyl crackle and hiss, a plate-like reverb, and a quiet level (−19 dBFS rms). Timing, velocity and detune are humanised from a fixed seed, so a rebuild is identical. Tunables are at the top of the script (BPM, swing, the MIX levels, the chord and melody tables).

**Seamless loop:** every note wraps around the loop end, the echo and reverb are circular, filters run on a tiled copy, and the wobble has whole cycles per loop. The file holds the loop with 0.1 s of its own end in front and 0.5 s of its start behind; the player loops the window in between as a Howler sprite, which is sample-accurate. In the encoded Opus file the join steps are 0.03× and 0.53× the normal largest step: no click.

**Measured (no ears involved, so please listen):** peak −8.2 dBFS, rms −19.1 dBFS; the loudness over 400 ms windows has a median of −21.7 dB and a maximum of −17.1; the typical 20 ms swell is 7 dB (99th percentile), the sharpest 18 dB (the strums, where the keys and thump land together). Octave balance falls gently from the mids (−10 dB at 1–2 kHz, −16 at 2–4, −25 at 4–8, −34 at 8–16), and the sub octave is at −11 dB. Two things found by measuring and fixed: the bass roots were so low (41–55 Hz) that the bass dominated the sub range, so they were moved up an octave; and the first soft beat was still too present, so its levels were pulled back.

**Files:** `music.webm` 445 KB (Opus, stereo, 56 kb/s), `music.mp3` 600 KB (fallback), `src/audio/music.json` (the loop window).

**Alternative kept:** `scripts/audio/build_music_calm.py`, the v2 calm electronic loop with no drums. It writes only to `.cache/music-calm/`, not the site; copy its `site-files/music.*` and `music.json` over `public/audio/` and `src/audio/` to use it. (The v1 drum-kit lo-fi was folded into this script: same chords, a different beat.)

**Its own switch (`src/audio/music.ts`).** Music and sound effects are separate settings: people often want clicks without music, or the reverse. Header: a spinning record (filled disc, centre label; one turn per 4 s while on, still when off or when motion is off), next to the sound-effects level meter and the Motion orbit. The sound toggle is now labelled "Sound effects". Each is saved on its own (`dean-music`, `dean-sound`).
- **Default:** on, like the effects, but only after the first click, tap or key press (browsers block audio before that); off on a Save-Data connection unless the visitor turns it on.
- **Loading:** it starts 1.2 s after the first gesture, behind the click sounds, so the click sounds are never held up by the 450 KB file. With music off the file is never requested.
- **Behaviour:** every change of state fades, never cuts. In over 3 s when it starts or is switched on; out over 1.4 s when switched off, then paused; out over 0.6 s when the tab is left (then paused) and back in over 1.5 s on return. Measured: 0.34 down to silence in 1.4 s on a real click, and 0 up to 0.34 in 3 s. The level is 0.34 of the file (`VOLUME` in `music.ts`), a bed under the clicks. The old drone from §15 is gone: under a real track it would muddy the mix.

**Phones:** four controls plus the action no longer fit at 375 px, so below 441 px the header action reads "Hire Dean" (above that, "Work with Dean"); below 360 px the capsule and button tighten. Measured: 375 px, 20 px clear; 360 px, 5 px; 320 px, 10 px; 430 px, 75 px.

**Audition:** `lab/sound.html` has a music switch beside the sound-effects one.

## 19. Page tab bar without numbers (2026-10-01)

The Console's tab bar reads "Works Events About Contact": the 01–04 numbers are gone from it (and from the List view's section links before). The wallet's own top keys keep their engraved 01–04, and so do the screen's softkey labels under them (they label those keys), and keys 1–4 still work. Phone tab labels went from 12 to 13 px with the room freed.

## 20. "Chronicle" is now "Events" (2026-10-01, Dean's choice)

The section of speaking, hosting and community work is called Events: tab bar, panel title, List view heading and link, the screen's label ("EVENTS") and the page description. Internal keys (`chronicle` in the code, `#/stage/…` links, `lv-chronicle` anchors) are unchanged, so existing links keep working.

## 21. Motion icon: a bouncing ball (2026-10-01, Dean's request)

The Motion icon was a dot orbiting a ring, too close to the new spinning record (both rotate). It is now a ball bouncing off a floor line: it falls with an ease-in, squashes as it lands (wider and shorter), and rebounds with an ease-out (1.5 s a cycle). The shadow widens and darkens as the ball comes down. With motion off the ball rests on the floor and the line is dashed. Transform and opacity only.

## 22. Share card and SEO (2026-10-01, Dean's request)

**The share card** (`public/og-image.jpg`, 1200 × 630, 62 KB: under WhatsApp's ~300 KB limit): the site's own hero lockup ("Dean" in Inter, "Studio." in Instrument Serif), the header's cream brand pill, the tagline "UI/UX, frontend and creative design for Web3 products." and `dean-fi.my`, beside the real 3D device in its hero pose with the Hello screen on it, over the site's violet and champagne glow. The device is rendered from the live scene (the screen is normally an HTML layer, so its Hello page was drawn onto a temporary plane for the render) and the card was composed in the page so it uses the site's real fonts. It is a static file: the clock on its screen reads the time it was made. Regenerate it if the look of the screen, the tagline or the domain changes.

**Link previews** (`index.html` head): Open Graph (WhatsApp, Telegram, LinkedIn, Slack, Discord, Facebook) and Twitter/X `summary_large_image` tags with the card, its size and alt text. The image URL ends in `?v=1`: raise it whenever the image changes, because the apps cache previews (Telegram: ask `@WebpageBot` to refresh; Facebook and LinkedIn have debugger pages; WhatsApp refreshes after a while or with a new `?v=`).

**SEO:** a 58-character title ("Dean Studio · UI/UX, frontend and creative design for Web3"), a 146-character description, the canonical address `https://www.dean-fi.my/`, `robots` (index, follow, large image previews), `public/robots.txt` and `public/sitemap.xml` (home page; deep links are `#` routes, which search engines treat as the home page), structured data (JSON-LD: WebSite and Person, with the LinkedIn profile only: no email, no phone), a web manifest and icons (`icon-192/512.png`, `apple-touch-icon.png`, all made from the logo), `<noscript>` hides the loader so the page isn't blank without JavaScript, one `<h1>`, `lang="en"`.

**On the host:** serve `robots.txt`, `sitemap.xml` and `site.webmanifest` from the site root (Vite copies `public/` to the build root); make the bare domain `dean-fi.my` redirect to `www.dean-fi.my`; after deploying, submit the sitemap in Google Search Console and test a link in each app. The image URLs assume `https://www.dean-fi.my`; if the domain changes, replace it in `index.html`, `robots.txt` and `sitemap.xml`.

**Two images (2026-10-02, Dean's request):** WhatsApp shows a square thumbnail, so there are two cards. `public/og-image-square.jpg` (1200 × 1200, 97 KB) is just the logo: a champagne D and star with a soft glow on a dark violet background with faint concentric rings, a few sparkles, a vignette, a hairline border and fine grain. It is the first `og:image`, so WhatsApp and Telegram take it. `public/og-image.jpg` (1200 × 630) stays as the second `og:image` and as `twitter:image` (X's large card is wide). Apps differ in which tag they pick, and a static page can't choose per app; the order above is the best fit. Both URLs carry `?v=2`.

## 23. First-load lag (2026-10-03, Dean's report)

**What was slow** (production build, RTX 3060 laptop, Chrome/ANGLE D3D11, repeated cold loads): the loader stayed up for about 4.5 s and the main thread was blocked for nearly all of it. About 1.6 s of that was `createStudioEnvironment` (the PMREM generator compiles three shaders, one of them the GGX convolution, synchronously on every visit); about 2 s was compiling the wallet's 14 shader programs. After the loader lifted, the stickers' texture work (three chunks of 0.4–0.7 s) and the key card's shaders ran straight into the wallet's 1.4 s arrival animation, so it stuttered. The screen's mono 500/700 weights were only requested after the reveal, so their text swapped fonts in front of the visitor.

**What changed**
- **Baked environment.** `src/device/generated/studio-env.bin` (192 KB; the raw half-float pixels are 6.3 MB) holds the finished PMREM: RGBE bytes (shared exponent, mean error 0.25 %, worst 0.0156 against a brightest texel of 5.5), four planes, delta-coded, zlib. `loadBakedEnvironment()` fetches and decodes it (~70 ms, starting as `main.ts` evaluates) into a CubeUV `DataTexture`; `createStage` takes it as an argument. If the file or `DecompressionStream` is missing it falls back to the generator, and `?env=live` forces that for comparison. Re-bake whenever the softboxes in `studioEnvironment.ts` change: `lab/bake-env.html` (dev server), Bake then Verify; the dev server writes the file. The decode loop is its own plain function on purpose: inside the `async` loader V8 kept it interpreted and it took 290 ms instead of ~30.
- **Background work waits.** The key card's shader compile and the stickers now start 2.5 s after the first frame (the entrance has settled) and then at an idle moment; the stickers are built one at a time with an idle gap between, so frames get a turn.
- **Fonts.** All five faces are requested at start (`FACES` in `main.ts`) and the loader waits for them (they are 12–15 KB each, fetched in parallel).

**Result** (same machine): environment step 1 600 ms → 1 ms plus a 40 ms decode; first frame about 4.5 s → about 3.2 s (the rest is JS evaluation, building the wallet and key card at ~0.5 s, and the shader compile); no long task in the arrival animation (the 0.5–0.65 s sticker chunks now run 3+ s later, in idle gaps). What remains is the 14-program compile; cutting it would mean simpler materials, which changes the look.

**Detail panel pager (2026-10-03, Dean's request):** the previous/next links showed whole titles ("Monster GameFi Soft Launch") and wrapped to two lines on phones. Each is now a short label, "‹ Previous" / "Next ›", with the title as a one-line muted sub-label that is ellipsised if it ever overflows; on phones (≤ 760 px) the titles are hidden and only the labels show. The full title stays in each button's `aria-label`.

## 24. Sticker QR easter egg and the OpenCrew project (2026-10-03, Dean's request)

**Hidden QR under each sticker.** Under each back sticker is a second sticker: a real QR code (encoded with `uqr`, a ~10 KB lazy chunk fetched with the stickers; ECC level L) to the partner's site: Open Crew `https://open-crew.vercel.app/`, ASEAN Labs `https://aseanlabs.io/`, MyDAC `https://www.mydac.org.my/` (`STICKERS` in `stickers.ts`). The code is a matte white rounded-square sticker with a thin foil rim and a 2-module quiet zone. Its size and position come from `fitSquare`: the largest square that lies inside that sticker's die-cut mask (an integral image of the mask) *and* ends before the fold's furthest reach whichever corner is lifted, so the QR is never visible until its sticker is peeled (0.13–0.18 W; it hides behind all three at any of the four peel corners). The three textures decode back to the right URLs (checked with OpenCV).

**Interaction (same on desktop and phone).**
1. Drag a sticker to peel it. It can now travel to 90 % of its diagonal (`MAX_FRACTION`, was 70 %), with a softer rubber band (`RESIST`), so a ~150 px pull on a phone-sized wallet is enough.
2. Crossing `COMMIT` (80 % of the travel) ticks (`detent` sound, a short vibration where the browser allows it). Let go before it and the sticker lays back down as before.
3. Let go past it and the flap **stays rolled back** (`LATCH_ANGLE`, nearly folded over itself) with a chime and a longer buzz; the QR is showing; one sticker is open at a time (opening another puts the first back).
4. While open: tap the **QR** (hit target 1.8× the code, because it is ~30 px on a phone) to visit its site in a new tab, and the sticker goes back; tap the **flap**, press **Esc** or the pill's **✕**, press the wallet's Back key, or turn the wallet (drag it, or it flips to the front by any route) to put it back without visiting.
5. A **link pill** (`#qr-pill`, bottom centre) appears while one is open: "Scan the code or tap here" over the host. It is a real `<a>`, so it works from the keyboard and wherever a tap on the 3D code might not open a window, and it is announced to screen readers. It is the dependable path on a phone.

**Honest limit: scanning.** The QR is a hidden sticker on a wallet that is ~280–450 px wide, so the code itself is 30–60 px on screen (1–2 px per module): a phone camera can scan it only from a large or zoomed display. Tapping is the main route; the code is for show and for big screens.

**OpenCrew project** replaces AIT NET in Works, placed sixth, directly above Fortuna HK (first screen of the device list). Tools: Claude; roles as for the other sites; stack Next.js / React / Turbopack (read from the live site's `/_next/` assets); status Shipped (it lives on a `vercel.app` address, like Eniac Labs). Two 1280 × 800 screenshots (hero; Global Crew section) are the thumbnails and the dithered device-screen image comes from the second, made by `scripts/media/project_media.py` (the same recipe as the other projects). The AIT images were removed.

## 25. Four thumbnails per project; healing is the peel in reverse; peel and heal sounds (2026-10-03, Dean's request)

**Thumbnails.** Every project now has four 1280 × 800 images (`<id>-1`…`-4.webp`): the two it had, plus two more sections of the live site, captured with headless Chrome after scrolling the page once so reveal animations are in (Eni uses fullPage.js, so its sections were stepped with its own API; Kairma was captured after its own "Skip to OS" button). The two new frames per project: Eni (Matrix, Flywheel), ASEAN Labs (the three audiences, Built for reality), Kairma (the red landing, the model-pricing table with its isometric cube), PayGo (the problem, Separation of Powers), Eniac Labs (sectors, the testimonial band), OpenCrew (client stories, the partner network), Fortuna (enterprise, the globe), Nikola (three layers, network scale), FlowFi (capital, the closing call), PUSC (mint, collateral timeline). Kairma's site has since moved to a dark red theme, so its first two thumbnails (older, light) look different from the new ones. `scripts/media/project_media.py <id> --more <shot…>` adds further frames. The detail panel's thumbnail row is now a grid of up to 96 px tiles that shrink together, so four fit a phone (a flex row of fixed 96 px tiles overflowed and pushed the main image past the panel edge).

**Healing = the peel run backwards.** Putting a sticker back used to spring the fold to the corner in 0.28 s while the flap angle snapped to rest on its own timer. Now one tween drives the fold distance back to the corner, and the flap angle is computed from that same number with the curve it followed on the way up (`angleFor`), so they cannot drift apart and the flap swings back down through vertical exactly as it came up. The heal eases in and out over 0.35–0.85 s (longer the further it has to go; a fully latched flap takes 0.85 s), and as it touches down the sticker presses into the plate (scale 0.992 over 70 ms, back over 180 ms). A flap let go before it latches uses the same machinery with a springier ease (0.4 s). **Reduced motion (the OS setting or the site's Motion switch) is gentler, not instant**: the same reversal, capped at 0.3 s (latching 0.2 s), no press as it lands. It was briefly instant, which read as no animation at all to anyone with Motion off; the flap is a few percent of the screen and answers the visitor's own tap, so a quick movement is the right reduction. Sampled per frame, the flap's height rises 0.099 → 0.118 (over the vertical) and then falls to 0 at ~0.8 s with no step.

**Sounds** (`scripts/audio/build_sfx.py`, 12 sounds now). The first `rip`/`unpeel` were a pitch-sweeping filtered hiss with sparse clicks and read as a whoosh, not an adhesive, so they were rebuilt (2026-10-03, Dean: "kinda weird, try again"). A real peel is stick-slip: thousands of fibres letting go, heard as a dense stream of tiny dry snaps in irregular bursts, broadband with its weight at 2–9 kHz, with the film flexing underneath and a few bigger snaps. `crackle()` builds exactly that: events drawn at a rate that follows the pull (bursty, never silent), each a pair of fast-decaying resonances at a random frequency plus a hint of noise at a log-normal level, a quarter of them carrying a low film thump, over a faint broadband bed, then soft-limited so the big snaps don't bury the body. There is no pitch sweep (a pitched hiss is what makes it whoosh). Three sounds: `peel` (0.17 s, a tight burst as the corner is grabbed), `rip` (0.6 s: starts slow and sticky, quickens, ends abruptly with the release; played once per pull, louder for a faster pull, not again until the flap has travelled on, at least 450 ms apart) and `unpeel` (0.85 s: the rip's pattern with time reversed, so it starts dense and thins and softens as the flap settles, but every snap inside stays forward, because a literally reversed waveform sounds like a suction effect; it ends in a soft low press that lands with the animation). `unpeel` plays at the start of a heal and, sped up ×2, when a half-pulled sticker springs back (silent for a nudge too small to have torn anything). Measured: centroid ~5 kHz, 92 % of 10 ms windows active (continuous), crest factor ~8.6. The chime on latching and the tick at the 80 % line are unchanged. All are in the sound lab. Checked by waveform and spectrogram (`.cache/sfx/sheet.png`) and by those numbers, not by ear.

## 26. Phone bug: tapping the wallet sent the page back to the Hero (2026-10-04, Dean's report)

**Symptom.** On a phone, tap a top key (say 01): the page scrolls to the Console and shows Works. Tap the wallet to pick a project: the page jumps back up to the Hero.

**Cause.** Each place is `min-height: 100svh`. Once a phone's address bar hides, the viewport is taller than `svh`, so the page ends 50–100 px before the Console's top and can never rest exactly on it. The Hero↔Console snap (`queueSnap`, main.ts) only counted the Console's exact top as "arrived", so a page resting at its end counted as "in between", and the next scroll event of any kind (a 1 px finger drift on the wallet, the address bar coming back) finished the "move" toward the Hero. The emulator never showed it: there is no address bar to hide.

**Fix.**
- "At the Console" = the Console's top or the end of the page, whichever comes first (`Math.min(consoleEl.offsetTop, lenis.limit)`).
- A drift under `SNAP_DEADZONE` (48 px) from where the page last rested goes back to that place; only a real scroll changes place. This also covers the address bar returning, which moves the page's end without the visitor scrolling (the page then re-settles on the Console's top).
- The wallet's scroll-scrubbed pose uses `end: 'clamp(top top)'`, so it completes at the page's end instead of stopping ~90 % of the way.

**Verified** in the phone emulator with the sections shortened by 80 px (the page ends at 652 px, the Console's top is 732 px, as on a phone with the bar hidden). The old code reproduced the bug: after 01 and a tap on a row, a 1 px scroll returned to the Hero. With the fix: 1, 6 and 30 px drifts stay on the Console; restoring full height (the bar coming back) re-settles on the Console's top (812); a 160 px scroll up goes to the Hero and a 120 px scroll down to the Console; the wallet's pose at the short page's end equals the pose at the full page's top. Desktop scrolling is unchanged.

## 27. Contact: the key stays in the reader; the screen shows the details (2026-10-04, Dean's request)

**Before.** The key card went into the reader, the screen showed "Writing details…", then the card ejected and floated beside the wallet (in front of it on phones, where the page title faded to make room) with the details printed on it.

**Now (desktop and phone).** The card flies in and seats in the reader (same arrival: lined up at the mouth, pushed home, the latch recoil and the LED flash). It stays there. The wallet turns its screen back to the visitor with the card sticking out of the reader on the right, the screen runs its stepped bar ("Reading key…", "Keep the key in."), and after 1.15 s it shows "Key read ✓" with the three channels (Email, WhatsApp, LinkedIn) to pick and open from the screen. The screen is the primary view; the slotted card is the proof. "Put the key away" (or leaving Contact) turns the reader side toward the visitor, the reader's spring pushes the card out, and it flies off.

- **Phones (Dean, 2026-10-04):** the screen and its details are what matter, so the wallet stays centred at full size and, while the card is in, turns to face the visitor straight on (the actor turn cancels the Contact pose's −0.36 rad). The screen's centre lands at the viewport's centre (187–188 px of 375); the slotted card is allowed to run off the right edge. (A first version slid the wallet left and down to 92 % so the whole card showed; Dean preferred the centred screen.) The page title no longer fades (nothing comes in front of the copy any more).
- **Reduced motion:** the card appears seated, the screen shows the details at once.
- **Removed:** the floating card's HTML label (the details printed on the card) from the live site, the card's resting position in front of/beside the wallet (`cardFinal`), and the phone title fade. The occlusion rule that hid the screen when the card was in front of it now skips a slotted card. The lab (`lab/contact.html`) still has the old floating card for reference.
- **Copy:** the Contact lede now says "Dean's key goes into the reader and the wallet's screen shows the details."; the screen says "Reading key…" then "Key read ✓".

Verified in the browser (desktop and a 375 × 812 phone): card slotted at ~0.6 s, "Reading key…" at ~0.85 s, "Key read ✓" with the channels at ~2 s, card still in the slot afterwards; put-away ejects (0.43 → 0.99 W) then flies off and restores the wallet's pose, position and scale.

## 28. Copy the email from the wallet's screen (2026-10-04, Dean's request)

On the Contact screen, once the key is read, the footer's middle slot is a **Copy ⧉** key whenever Email is selected (it is, by default): ‹ Back · Copy ⧉ · Open ✓. Tapping it (or pressing **C** with Email selected) copies the full address to the clipboard (`copyText`, with the textarea fallback), plays the detent tick, announces "Email address copied" to screen readers, and the slot says "Copied ✓" (or "Copy failed") for 1.6 s, then goes back to Copy. On WhatsApp and LinkedIn the slot shows the position ("2 of 3") as before. The label is underlined so it reads as tappable. The address is joined only on request, as for the mailto link, so it still never sits whole in the page's HTML. Open ✓ on Email still opens the mail app; the List view's contact card already had its own copy button. Verified: one click → one copy of the full address (23 characters, not the shortened display), C copies, the slot reverts after 1.6 s, WhatsApp shows "2 of 3" with no action.

## 29. Project copy rewrite and the Design flow section (2026-10-06, Dean's request)

**Copy.** All ten project descriptions were rewritten from Dean's keywords (who did what, what was custom, what shipped), with the humanize skill's checks (no em dashes, none of its flagged vocabulary, no claim beyond his notes; the client one-liners come from the earlier copy). ENI's roles are now UI/UX Designer and Frontend Developer (a team project); statuses follow his notes. Each project also has `flow: { steps, text }` in `portfolio.json`: his stages, with "Inspiration" written as "Moodboard" and ENI's v1/v2/v3 as "Builds v1 to v3", and a short account of how the work went.

**Design flow section.** In the project panel, between the description and Tools used: a heading, an animated figure, the stages as chips joined by arrows (see §30), and the text. The panel is now `min(720px, 60vw)` wide on desktop (was 620 px / 56 vw) so the gallery and figure have room; phones keep the bottom sheet.

**The figure: `chain`** (`src/figures/chain.js`), made with the **hairline-create** skill (installed at `~/.claude/skills/hairline-create` from lucasmarkes/hairline; MIT) and passed by its validator and its look (frame, read-out, console, flicker and the eight-picture sheet). Dean chose concept 1 of three (chain of blocks / signing line / block height):
- One rounded block per stage, joined by interlocking links like the wallet's keychain (one upright, one flat), lying in an arc that grows with the chain's length (a 3-stage chain is nearly straight). The newest block rests slightly raised and lit (the chain's tip).
- A block is a stack of plates: 1 for a single pass, 2 for MVPs or an iteration, 3 for builds that went v1 to v3 (`toChain` in `src/ui/flowFigure.ts` reads them from the stage names).
- Endings: Handover → a dashed link to the dashed first block of another team's chain; Maintenance → a dashed link to an empty dashed footprint (the next block's place).
- Pointer: the block under it lifts and fans its plates; neighbours follow at 34 % and 10 %, staggered 45 ms by distance; the bright edge moves to it. Hit-tested on the rest pose (rule 01). Touch: horizontal drags answer, vertical swipes scroll (`touch-action: pan-y`). The corner read-out names the stage ("03 MVPs") and says "N stages" at rest; screen readers get the figure's label (all stages) and the list.
- Look: strokes in the site's palette (champagne for the one highlight), plates filled with the panel's colour (`--hairline-*` on `.dt-fig-stage`).

**How it runs.** `src/vendor/hairline/kernel.js` is the skill's engine, unchanged, with `export default HL;` appended by `scripts/hairline/vendor-kernel.mjs` (re-run after updating the skill); MIT licence beside it. `flowFigure.ts` is the host (what the skill's bench page does): it loads the kernel and the figure on the first project panel (10 KB + 3.6 KB, their own chunks), follows the site's Motion switch (`setReducedMotion`), and the panel tears the figure down when it changes or closes, so one figure is live at a time and it sleeps offscreen. `.hairline/` (git-ignored) holds the skill's build and look outputs: `cd .hairline && node ~/.claude/skills/hairline-create/look.mjs ../src/figures/chain.js --answer 128,34,22 --edge 0,0,22 --edge 384,22,26`.

The npm package `@lucasmarkes/hairline` was installed first and then removed (Dean's call): its nineteen figures are fixed, and the custom figure runs on the skill's kernel, vendored here.

Verified in the browser: all ten panels mount their figure with the right number of stages (ENI 7 … Nikola 3), the four with a handover or maintenance draw their dashed ending, the hover read-out and highlight work in the site's colours, one live figure at a time, no console errors, phone (375 px) layout without overflow.

## 30. Design flow: the chain plays itself; stage chips with arrows (2026-10-06, Dean's request)

Dean compared four figures for FlowFi on `lab/flow-compare.html` (chain, signing line, block height and a flowchart; the other three and the comparison page are kept out of the repo, in the git-ignored `.hairline/experiments/`) and kept the **chain**. Few people find a hover state with nothing pointing to it, so the figure now shows its own gesture.

**Auto play** (`auto: true`, passed by `detail.ts`; the bench and lab do not pass it). Inside the figure's `register` tick, so it runs only while the panel's figure is on screen and stops with the figure:
- After 0.9 s at rest, each stage in turn is picked exactly as the pointer would pick it (lift, plates fan, neighbours follow, read-out "02 Moodboard"), then the chain rests 2.2 s with the tip lit and goes round again.
- Each stage is held `clamp(8400 / n, 1100, 1500)` ms: 1.5 s for 3 to 5 stages, 1.2 s for ENI's 7, so a round lasts about 6.7 to 10.6 s (5.7 to 9.6 s of stages plus the rest).
- The pointer on the figure, or a chip, takes over at once. When it lets go, the chain rests 2.6 s, then starts again from the first stage.
- Reduced motion (system or the site's Motion switch): no play; the chain returns to rest and still answers the pointer and the chips.

**Stage chips** (`.dt-steps`): no numbers; an arrow before every stage after the first. When the list wraps (phones, long flows), the stage that starts a new row gets a turn arrow (↳, down from the row above and on) instead of →; `markWraps` measures the rows with a ResizeObserver, and both arrows are 14 px, so swapping one never moves the layout. The chips are buttons and stay in step with the figure through `onPick`: the stage shown (by the play, the pointer or a chip) is lit in champagne with the arrow into it; at rest the last stage is lit, as the chain's tip is. Mouse hover on a chip shows that stage; leaving the list lets go. Keyboard focus shows it; blur lets go. A tap holds it 3.2 s, then the play returns.

Verified in the browser: the loop timing on ENI (1.2 s per stage, 2.2 s rest), chip and figure in sync both ways under a real mouse, resume after leaving (2.6 s, from stage 1), wrap arrows on ENI (desktop, Handover on row 2) and Kairma (375 px, Iteration starts row 2), a simulated tap (held, then back to the play), reduced motion (back to rest, no play), no console errors.


## 31. Works › Mobile apps, coming soon (2026-10-06, Dean's request)

Dean's selected works are all web design and development so far; mobile app design and development comes later. He chose where it lives (a second page of Works, not a fifth key: the wallet has four physical top keys) and the coming-soon treatment (a firmware update).

**Works has two pages, WEB and APPS.** The screen's status strip reads `WORKS WEB APPS`, the page showing inverted; both labels can be tapped. Ways to flip: press **01 again** while on Works (the wallet's key, its softkey, or key 1), **← / →**, the labels on the screen, or the **Web / Mobile apps** switch above the text beside the wallet (`.work-kind`). On APPS, the Back key (footer "‹ Web") returns to WEB. Arriving at Works from another section always lands on WEB, and leaving Works resets it; opening a project (✓, a deep link) also shows WEB with that project selected. The roller has no list on APPS (it stops; the page can scroll). APPS doesn't fall asleep to the idle mark. Screen readers hear "Mobile apps: coming soon" / "Web projects" on a flip. The page text follows the screen: "Mobile app design and development. Coming soon." List view (and no-WebGL) shows the same line as a card under the web projects.

**The coming-soon screen** (`screen.ts`, `screen.css` `.sc-soon`): a hardware-wallet-style update that never quite finishes. A line-drawn phone whose nine app tiles install one by one (dashed outline → dithered "downloading" → solid ink; the ninth stays downloading), a COMING SOON stamp, "Installing Mobile Apps", a 20-block bar with its percentage, and a line saying what it is doing (Sketching user flows… → Designing screens… → Building the app… → Testing on phones… → Almost there…). Every step redraws at once, like an e-ink partial refresh (nothing eases); steps come at uneven intervals (380–900 ms), reaching 99 % in about 8.5 s, then it holds on "Almost there…" for 3 s, does a full-refresh flash and starts again (about 11.4 s a round). It runs only while APPS is showing. Reduced motion (system or the Motion switch): the held 99 % frame, still; the switch takes effect at once.

Verified in the browser: every way to flip (key 1 twice, from another section, softkey 01, ← →, the Back label, tapping APPS, the page switch) and the screen, switch and text in step; the reset on leaving Works; a project deep link from APPS (back to WEB, project selected); the loop timing; reduced motion; phone (375 px: no overflow, switch ~41 px tall on touch); List view card; no console errors.
