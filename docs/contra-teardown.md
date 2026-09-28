# Contra Project Calculator: teardown

Source: https://contra.com/project-rate-hiring-calculator/ (inspected 2026-09-27 in a live browser).
Purpose: reference for DeanFi3's structure and technique. Contra's code, models, textures, audio and copy are proprietary. **Study only. Don't copy assets or code.**

Evidence tags: `SOURCE` = seen in runtime DOM, network or bundle. `PARTIAL` = regex hit or a single observation, not confirmed.

## 1. Build stack

| Layer | Finding | Evidence |
|---|---|---|
| Framework | None. Vanilla JS, one hashed bundle `build/theme-*.js` (1.17 MB raw, 307 KB transferred) and one CSS file (58 KB). Hashed `/build/` naming suggests Vite. | SOURCE |
| 3D | Three.js r155, a single full-viewport `#webgl` canvas plus small canvases for quote marks and the CTA device | SOURCE |
| HTML on 3D | `CSS3DRenderer` overlay `#css3d`: the device screen UI is real DOM, matrix3d-projected onto the model | SOURCE |
| Scroll | Lenis smooth scroll on `main.scroll-container`; GSAP + ScrollTrigger drive pinned sections | SOURCE |
| Assets | Draco GLB (`/draco/*.wasm`), KTX2/Basis textures (`/basis/*.wasm`), one `envmap.png`, matcaps for the quote marks | SOURCE |
| Shading | Baked lightmaps per part (`*-lightmap-btns.ktx2`, `-lightmap-yes/no`), normal/roughness/metallic maps, `onBeforeCompile` shader patches | SOURCE |
| Post | EffectComposer-style post-processing in the bundle | PARTIAL |
| Audio | Howler, one audio sprite `audio/sfx.webm` (442 KB), mute toggle | SOURCE |
| Perf tiering | App state has `isLowTierGPU`, `isSpreadsheetView`, `baseCameraFocalLength` | SOURCE |
| CSS | Utility classes plus BEM, CUBE-style `block | utilities` class strings, responsive suffixes `d-block@md` | SOURCE |
| Fonts | Inter 400/500 (UI), Tobias Light (display serif), PP Neue Montreal Mono (screen/labels), self-hosted woff2 | SOURCE |
| Payload | About 7.1 MB over 82 requests, about 5 MB of it WebGL models and textures | SOURCE |

### How the device is modelled (the key craft point)

The device is **not one model**. It is 35+ small GLBs: `section1base`, `section2base`, `section3base`, `dial`, `button1/2`, `accept`, `confirm`, `yes/no`, `slider`, `onoff`, `hinge`, `screen1/2`, `screenborder`, `tag`, `logo` and others. Each moving part is its own mesh, so it can be animated (pressed, rotated, slid) and re-lit using baked lightmap swaps (e.g. `lightmap-yes` / `lightmap-no` for the state of the lit buttons). That's why it feels tactile.

## 2. IA / page flow

Single page with a linear guided flow:

1. **Preloader**: an animated four-point star mark (very close to Dean's D-star sparkle).
2. **Hero**: "Smarter hiring, calculated." The device floats beside the large serif headline, with a "Scroll to discover" cue.
3. **Steps 01–04** (pinned, `h-100vh` each): Project type → Primary skill → Experience level → Preferred location. A step counter "STEP 01 — 04" and a large label sit bottom-left. On the device screen, the **mouse wheel turns the dial** and moves the list selection, ACCEPT confirms, and RESET clears.
4. **Result**: "Get a curated list of freelancers for your project", with an email capture on the device screen.
5. **Quote slider**: testimonials with 3D matcap quote marks.
6. **CTA**: "Take your projects to the next level", with a smaller device render and gradient glow.
7. **Footer**: socials and policies.

Persistent chrome: pill brand badge top-left; Share and "Hire on Contra" top-right; audio toggle; menu; film-grain `.noise` overlay; methodology modal; a **Calculator ↔ Spreadsheet** toggle for the non-3D view.

## 3. What to borrow vs avoid

**Borrow**
- One hero object that *is* the interface. Its screen shows real content and its physical controls map to site actions.
- Part-split models so every control can animate on its own.
- HTML-on-screen: crisp, selectable and accessible text on the 3D device.
- A plain "spreadsheet" (list) view alongside the 3D experience.
- A restrained palette: near-black `#121212`, a violet accent and one light surface. Big serif display with a mono UI.
- GPU tiering and an audio sprite with a mute toggle.

**Avoid**
- Wheel hijacking. The page stops scrolling while the dial eats wheel input, which confuses trackpad users.
- No `prefers-reduced-motion` handling found in the bundle.
- The 7 MB payload. On 375 px mobile emulation the loader was still showing after about 15 s (emulated, not a real device: PARTIAL).
