# Image analysis: hardware wallet reference set (7 photos)

Primary reference: `references/wallet/1.png` (front three-quarter).
Measurement reference: `references/wallet/2.png`, straight-on front, grid overlay at `grid2.png`.
Supporting views: 3 (rear three-quarter), 4 (front in hand), 5 (rear edge and card), 6 (marketing front), 7 (touch UI in hand).
Unit **W** = body width.

## L1 Identification
- Work type: handheld hardware crypto wallet with an e-ink touchscreen, plus a separate square NFC card.
- Classification: consumer electronic device. `primaryDomain`: object. Confidence 0.95.
- Reference product: Ledger Nano Gen5. **Target is an original, Dean-branded derivative, not a replica** (see `docs/device-design.md`).

## L2 Form and silhouette (measured on image 2)
- Body: rounded-rectangle slab (extruded rounded rectangle), bilaterally symmetric in outline, geometric shape language.
- Height 1.50 W (383/256 px). Outer corner radius ≈ 0.09 W.
- Thickness ≈ 0.14–0.16 W. **This is an inference** from the foreshortened side band in images 1 and 3. No orthographic side view exists.
- Edge profile: continuous rounded edge. The face-to-side transition is a soft radius (≈0.03 W), not a chamfer. Images 1 and 3 show a tight specular roll-off.
- Companion card: square ≈ 0.81 W × 0.81 W, corner radius ≈ 0.04 W, thin (≈0.02 W, inferred).

## L3 Decomposition
- **Macro:** body shell, front cover glass, display, chin control, side button, rear panel, port; card (separate).
- **Meso:** display active area inside a glass window. Glossy black bezel ring. Chin zone with a pill key (bottom right) and an embossed corner-bracket logo (bottom left). Side button on the +X edge in the upper third. USB-C port on the bottom edge. The rear has an embossed bracket logo near the top +X corner.
- **Micro:** a 1 px lighter inner border around the glass window. Dashed UI dividers (screen content). The card has a dot-cross grid, corner marks and a printed motto.

## L4 Spatial relationships
- `<cover glass, flush-with, front face>`, overlapping the full front.
- `<display, embedded-in, under glass>`. Active area x 195–397, y 72–345 px. Insets from the body edge: side ≈0.105 W, top ≈0.105 W.
- `<chin, below, display>`, height ≈0.30 W.
- `<pill key, embedded-in, chin>` at bottom right: 0.17 W × 0.08 W, ≈0.08 W from the right and bottom edges.
- `<side button, attached-to, +X edge>`: length ≈0.16 W, starting ≈0.22 W below the top, protruding about 0.01 W.
- `<port, embedded-in, bottom edge>`, offset toward -X. From image 3 its exact x position is uncertain.

## L5 Materials (PBR)
- Front glass: dielectric, roughness ≈0.05, clearcoat. Black albedo under the bezel, transparent over the display.
- Side frame: dielectric, black, roughness ≈0.35 (satin). Image 1 shows a broad soft highlight.
- Rear panel: dark grey, roughness ≈0.7, fine grain normal (soft-touch). Image 3 shows almost no specular.
- Display: e-ink. Matte, roughness ≈0.9, unlit look, light grey paper albedo ≈#d6d6d4. Content is 1-bit or dithered greyscale.
- Pill key: brushed or satin light metal or ceramic, roughness ≈0.3, with a printed icon.
- Card: matte black, roughness ≈0.8, fine noise normal, printed dot grid.

## L6 Colour and finish
- Body: near-black, low saturation, value ≈8–12%. Rear: dark grey, value ≈30%.
- Display paper: neutral light grey, value ≈82%. Ink: value ≈15%.
- Key: light grey, value ≈80%.

## L7 Identity-defining features
1. Large portrait e-ink display filling about 70% of the face.
2. Deep glossy bezel with a thick chin.
3. Single chin key at bottom right.
4. Corner-bracket brand mark on the chin and rear. **This is a Ledger trademark and must not be reproduced.**
5. Side button in the upper +X third.
6. UI language: dashed dividers, inverted selected rows, bottom action bar with a pager ("5 of 5") and a hold-to-confirm checkbox.
7. Companion square card with a dot grid.

## L8 Uncertainty
- There is no orthographic side, top or bottom view. Thickness, port position and the side-button profile are inferred.
- The rear is visible only in perspective (image 3). The flatness of the rear panel versus a slight dome is undetermined.
- The images are low resolution (≤531 px), so micro texture and grain are unreliable.
- These unknowns are acceptable. The target is an original derivative, so the dimensions are design decisions rather than measurements to match.
