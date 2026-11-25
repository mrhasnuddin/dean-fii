# DeanFi3 design tokens

The site's tokens are the custom properties on `:root` in `src/styles/site.css`. Components read them; nothing hard-codes a family, a brand colour or the type settings below.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0f1014` | Page and stage background |
| `--ink-light` | `#ece8df` | Primary text on dark |
| `--muted` | `#8b8d96` | Secondary text, hints, icons at rest |
| `--line` | `#2a2c33` | Hairlines and borders |
| `--champagne` | `#e4cf9f` | The accent: primary button, active states, the device's metal |
| `--champagne-light` | `#f2dfb6` | Accent hover and focus rings |

## Type

Families (self-hosted fonts, imported in `src/main.ts`):

| Token | Family | Role |
| --- | --- | --- |
| `--font-display` | Apfel Grotezk | Titles, the hero's second line, the closing quote |
| `--font-ui` | Geist | Body, buttons, pills, the tab bar, the hero's first line |
| `--font-mono` | JetBrains Mono | Labels, hints, callouts, the e-ink screen, the workflow figure |

How the display lines and the hero lockup are set in them:

| Token | Value | Meaning |
| --- | --- | --- |
| `--display-weight` | `400` | Weight of every display line (Apfel Grotezk Regular; `700` Fett is loaded for the flow screen accent) |
| `--display-scale` | `1` | Multiplier on every display size (`1:1` for Apfel Grotezk's generous x-height) |
| `--display-leading` | `0.96` | Line height of the large titles |
| `--display-tracking` | `-0.03em` | Letter spacing of the large titles (the detail title uses half, the List view's section titles three quarters) |
| `--hero-sans-weight` | `600` | Weight of the hero's first line ("Dean") |
| `--hero-sans-tracking` | `-0.035em` | Letter spacing of that line |

The weights in use: display 400 and 700; UI 400, 500 and 600; mono 400, 500 and 700. Text drawn onto the 3D parts is on a canvas and uses the system monospace.

## Layout and motion

| Token | Value | Use |
| --- | --- | --- |
| `--gutter` | `clamp(16px, 3.4vw, 56px)` | Page side margin |
| `--copy-bottom` | `max(84px, 9vh)` | Distance of the section copy from the foot of the view (clears the settings row) |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | The default ease for UI motion |

Changing the typography means changing these values and the imports in `main.ts`; see `docs/device-design.md` §38 for how the current pairing was chosen.
