"""Fill the pre-spec assessment from .img2threejs/analysis/image-analysis.md + docs/device-design.md.
Kept as a script so the reasoning is reproducible and diffable. Run: python .img2threejs/fill_assessment.py
"""
import json
from pathlib import Path

P = Path(__file__).parent / "assessment.json"
a = json.loads(P.read_text(encoding="utf-8"))
pre = a["preSpecAssessment"]

pre["objectClass"] = {
    "primaryType": "handheld hardware crypto wallet (original derivative of a portrait e-ink wallet form factor)",
    "primaryDomain": "object",
    "formLanguage": ["hard-surface", "rounded-rectangular slab", "soft face-to-side edge roll-off"],
    "structureKind": ["layered shell", "compound object", "articulated assembly", "repeated modules"],
    "motionPotential": ["whole-object transform", "articulated"],
    "materialFamilies": ["metal (thin-film iridescent coating)", "glass-like", "plastic", "metal (anodized champagne)"],
    "notes": (
        "Form factor measured from references 1-3 (H = 1.5 W, chin 0.30 W, screen 0.79 x 1.07 W). "
        "Controls, CMF and branding follow docs/device-design.md and are intentionally NOT the reference's."
    ),
}

pre["complexity"] = {
    "tier": "complex",
    "scores": {
        "silhouetteComplexity": 1,
        "componentCount": 3,
        "hierarchyDepth": 2,
        "repetitionDensity": 2,
        "materialLayerCount": 3,
        "localDetailDensity": 2,
        "occlusionRisk": 1,
        "actionReadinessNeed": 3,
    },
    "estimatedCounts": {
        "macroComponents": 4,   # shell, front glass, display, back plate
        "mesoComponents": 12,   # bezel ring, chin, confirm key, LED ring, back key, roller, 4 tabs, switch, port, slot
        "microFeatureGroups": 7,  # knurl ridges, tab numerals, key glyphs, logo emboss, back text, glass border, port detail
        "materialLayers": 7,
        "repetitionSystems": 2,  # roller knurl ridges, section tabs
    },
    "reasoning": [
        "Silhouette is a plain rounded slab (1); identity lives in proportions, bezel/chin depth and edge roll-off.",
        "Many discrete, individually animated controls push componentCount and actionReadinessNeed to 3.",
        "Repetition: knurled roller ridges (~36) and four identical section tabs.",
        "Materials: iridescent shell, glossy glass, e-ink paper, champagne metal, dark polymer keys, soft-touch back, LED emissive.",
    ],
}

# All single-view unknowns (thickness, flat vs domed back, port position, control side profiles) were
# resolved by design decisions; they are recorded in spec.assumptions by author_spec.py.
pre["unknownsToResolveBeforeImplementation"] = []

def d(i, kind, desc, region, scale, affects, ref, conf, ev="references/wallet/2.png"):
    return {
        "id": i, "kind": kind, "description": desc,
        "region": {**region, "units": "normalized"}, "scale": scale, "affects": affects,
        "mapsTo": {"type": "component.localFeatures" if "/" in ref else "material.localOverrides", "ref": ref},
        "evidenceRef": ev, "confidence": conf,
    }

pre["detailInventory"] = {
    "scanMethod": "component-zones",
    "targetMinDetails": 10,
    "note": "Zones from grid-3x3 scan of ref 2 (.img2threejs/analysis/zones) + design blueprint.",
    "details": [
        d("edge-rolloff", "bevel", "Face-to-side soft radius (~0.03 W) giving a tight bright rim highlight in refs 1/3",
          {"x": 0.36, "y": 0.09, "width": 0.56, "height": 0.83}, "meso", "geometry", "shell/edge-rolloff", 0.8, "references/wallet/1.png"),
        d("corner-radius", "contour", "Plan-view corner radius ~0.09 W", {"x": 0.36, "y": 0.09, "width": 0.1, "height": 0.1},
          "macro", "silhouette", "shell/plan-corners", 0.85),
        d("glass-gloss", "gloss", "Full-face glossy cover glass with sharp reflections (clearcoat)",
          {"x": 0.37, "y": 0.1, "width": 0.54, "height": 0.8}, "macro", "roughness", "front-glass/cover-gloss", 0.85, "references/wallet/1.png"),
        d("window-border", "linework", "1 px lighter border around the display window inside the black bezel",
          {"x": 0.4, "y": 0.14, "width": 0.47, "height": 0.62}, "micro", "albedo", "display/window-border", 0.7),
        d("display-matte", "decal", "E-ink active area: matte paper albedo, content from CSS3D HTML",
          {"x": 0.42, "y": 0.16, "width": 0.44, "height": 0.58}, "macro", "albedo", "display/eink-surface", 0.9),
        d("confirm-key", "ridge", "Round champagne Confirm key proud of the chin + LED ring groove",
          {"x": 0.72, "y": 0.8, "width": 0.14, "height": 0.1}, "meso", "geometry", "key-confirm/cap", 0.9, "docs/device-blueprint.html"),
        d("led-ring", "emissive", "LED ring around Confirm, fills while holding",
          {"x": 0.71, "y": 0.79, "width": 0.16, "height": 0.12}, "micro", "emissive", "key-confirm/led-ring", 0.9, "docs/device-blueprint.html"),
        d("back-key-glyph", "groove", "Engraved chevron glyph on the Back key", {"x": 0.39, "y": 0.8, "width": 0.08, "height": 0.08},
          "micro", "normal", "key-back/glyph", 0.8, "docs/device-blueprint.html"),
        d("roller-knurl", "ridge", "Knurled ridges around the thumb roller rim (repetition)",
          {"x": 0.35, "y": 0.3, "width": 0.03, "height": 0.12}, "micro", "geometry", "roller/knurl", 0.85, "docs/device-blueprint.html"),
        d("tab-numerals", "linework", "Engraved 01-04 numerals beside the top-edge tabs",
          {"x": 0.45, "y": 0.08, "width": 0.4, "height": 0.02}, "micro", "albedo", "tabs/numerals", 0.7, "docs/device-blueprint.html"),
        d("usb-port", "hole", "USB-C port recess centred on the bottom edge",
          {"x": 0.6, "y": 0.9, "width": 0.07, "height": 0.02}, "micro", "geometry", "port/usb-c", 0.75, "references/wallet/3.png"),
        d("lanyard-slot", "hole", "Lanyard slot with bevel lip in the bottom face at x = -0.30 W",
          {"x": 0.44, "y": 0.9, "width": 0.06, "height": 0.02}, "micro", "geometry", "lanyard-slot/opening", 0.9, "src/device/keychain.ts"),
        d("back-logo", "ridge", "D-star emboss on the back plate", {"x": 0.45, "y": 0.2, "width": 0.25, "height": 0.2},
          "meso", "geometry", "back-plate/logo-emboss", 0.85, "docs/device-blueprint.html"),
        d("back-softtouch", "stain", "Soft-touch microtexture on the back plate (high roughness, fine noise normal)",
          {"x": 0.3, "y": 0.1, "width": 0.6, "height": 0.8}, "micro", "roughness", "back-softtouch", 0.7, "references/wallet/3.png"),
    ],
}

a["preSpecAssessment"] = pre
P.write_text(json.dumps(a, indent=2, ensure_ascii=False), encoding="utf-8")
print("assessment filled:", len(pre["detailInventory"]["details"]), "details")
