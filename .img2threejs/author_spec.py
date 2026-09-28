"""Author object-sculpt-spec.json for the DeanFi device.

Sources: .img2threejs/analysis/image-analysis.md (form factor, measured on references/wallet/2.png)
and docs/device-design.md + docs/device-blueprint.html v0.3 (controls, CMF, keychain, screen).
Units: W = body width = 1. Frame: +X right, +Y up, +Z out of the screen (front). Origin = body centre.
Run: python .img2threejs/author_spec.py
"""
import json
from pathlib import Path

P = Path(__file__).parent / "object-sculpt-spec.json"
s = json.loads(P.read_text(encoding="utf-8"))
# Re-runnable: reviewHistory / sculptPipeline / visualEvidence are left untouched. The material
# template is kept in its own file so re-runs never inherit fields from an authored material.
TEMPLATE_FILE = Path(__file__).parent / "material-template.json"
if not TEMPLATE_FILE.exists():
    TEMPLATE_FILE.write_text(json.dumps(s["materials"][0], indent=2), encoding="utf-8")
MAT_TEMPLATE = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8"))

# ---------------------------------------------------------------- measured / designed constants
BODY = dict(w=1.0, h=1.5, t=0.15, corner=0.09, edge=0.03)
FRONT_Z = BODY["t"] / 2
SCREEN = dict(w=0.795, h=1.06, cy=0.115)            # active area, 3:4
WINDOW = dict(w=0.836, h=1.11, cy=0.113)            # glass window incl. lighter border
CHIN_Y = -0.59
CONFIRM = dict(x=0.30, y=CHIN_Y, r=0.085, ring=0.105)
BACK_KEY = dict(x=-0.32, y=CHIN_Y, r=0.06)
ROLLER = dict(x=-0.35, y=0.29, r=0.18, t=0.05, protrude=0.03)
TABS_X = [-0.25, -0.085, 0.085, 0.25]
TAB = dict(w=0.12, h=0.03, d=0.08)
SWITCH = dict(y=0.475, travel=0.03)
LANYARD = dict(x=-0.30, above=0.02)


def rect_points(w, h, r, seg=6):
    """Rounded-rectangle outline (counter-clockwise), for extrude profile2D."""
    import math
    pts = []
    corners = [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]
    for cx, cy, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append([round(cx + r * math.cos(a), 4), round(cy + r * math.sin(a), 4)])
    return pts


def recipe(dom, sec, cls, conf, grad=None):
    r = {"dominantAlbedo": dom, "secondaryAlbedo": sec, "materialClass": cls, "materialClassConfidence": conf,
         "evidenceRefs": ["docs/device-design.md#body-finish"]}
    if grad:
        r["colorGradient"] = grad
    return r


UNIT_PRIMITIVES = {"box", "plane-card", "sphere", "ellipsoid"}  # generator emits unit geometry scaled by transform.scale


def comp(cid, name, level, parent, primitive, dims, pos, material, *, role, topo, why, rot=(0, 0, 0),
         edge=None, descriptor=None, anim="static-child", pivot=None, axis=(0, 1, 0), channels=(), sockets=(),
         collider="box", features=(), rec=None, attach=None, importance=0.6, confidence=0.8, evidence=("full-object",),
         scale=None):
    """`pos` is the ABSOLUTE body-frame position; converted to parent-local after the tree is built."""
    gd = {
        "topologyIntent": why,
        "edgeTreatment": edge or {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "generated procedural coordinates",
        "normalStrategy": "vertex normals from generated geometry",
    }
    if descriptor:
        gd.update(descriptor)
    if scale is None:
        scale = dims if primitive in UNIT_PRIMITIVES else (1, 1, 1)
    ch = {k: (k in channels) for k in ("translate", "rotate", "scale", "bend", "twist", "detach", "visibility", "materialState")}
    return {
        "id": cid, "name": name, "level": level, "role": role, "importance": importance, "confidence": confidence,
        "primitive": primitive, "topologyClass": topo, "topologyRationale": why, "geometryDescriptor": gd,
        "parent": parent, "attachment": attach,
        "dimensions": {"width": dims[0], "height": dims[1], "depth": dims[2], "units": "W", "confidence": confidence},
        "transform": {"position": list(pos), "rotation": list(rot), "scale": list(scale)},
        "_abs": list(pos),
        "actionProfile": {
            "animationRole": anim,
            "pivot": {"mode": "custom" if pivot else "center", "localPosition": list(pivot or (0, 0, 0)), "axis": list(axis), "confidence": 0.8},
            "transformChannels": ch,
            "sockets": list(sockets),
            "collider": {"type": collider, "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": anim.startswith("control"),
                         "notes": "Raycast/click proxy for this control" if anim.startswith("control") else "static proxy"},
            "constraints": [],
            "destruction": {"breakable": False, "fractureGroup": parent or cid, "seamRefs": [], "detachableFragments": [],
                            "breakImpulse": 0.0, "debrisMaterial": material},
        },
        "material": material, "materialLayers": [material], "deformations": [], "joints": [], "seams": [],
        "localFeatures": [dict(f) for f in features],
        "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "",
                          "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""},
        "evidenceRefs": list(evidence), "details": [], "fidelityTier": "hero",
        "colorMaterialRecipe": rec,
    }


def axle(parent, socket, radius, length, axis=(0, 0, 1), embed=0.003):
    """Cylinder attachment. The generator puts the pivot at localStart and builds the cylinder from
    localStart→localEnd, both in PARENT-local space (radiusTop = endRadius, radiusBottom = baseRadius).
    Endpoints are filled in from the component's parent-local centre once the tree is resolved."""
    return {"parentId": parent, "parentSocket": socket, "_axis": list(axis), "_length": length,
            "baseRadius": radius, "endRadius": radius, "contactType": "embed", "contactNormal": list(axis),
            "embedDepth": embed, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"]}


def feat(fid, kind, desc, **extra):
    return {"id": fid, "kind": kind, "description": desc, **extra}


IRID = recipe("rgba(42, 43, 49, 1.0)", "rgba(58, 44, 60, 1.0)", "metal", 0.8,
              {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(52, 40, 58, 1.0)"},
                                            {"position": 0.5, "color": "rgba(27, 28, 33, 1.0)"},
                                            {"position": 1.0, "color": "rgba(28, 46, 46, 1.0)"}]})
CHAMP = recipe("rgba(227, 200, 148, 1.0)", "rgba(143, 127, 92, 1.0)", "metal", 0.9)
POLY = recipe("rgba(38, 40, 47, 1.0)", "rgba(74, 76, 85, 1.0)", "plastic", 0.85)
GLASS = recipe("rgba(11, 11, 13, 1.0)", "rgba(69, 70, 77, 1.0)", "glass", 0.9)
PAPER = recipe("rgba(232, 227, 214, 1.0)", "rgba(29, 28, 26, 1.0)", "plastic", 0.7)
DARK = recipe("rgba(6, 6, 7, 1.0)", "rgba(58, 59, 66, 1.0)", "plastic", 0.8)

HALF_PI = 1.5708
C = []
# Shell extrude spans z 0..t in its own frame, so its node sits at z = -t/2 to centre the body.
C.append(comp(
    "shell", "Body shell (frame + back)", "macro", None, "extrude", (1.0, 1.5, 0.15), (0, 0, -FRONT_Z), "shell-iridescent",
    role="body", topo="assembled-solid",
    why="Rounded-rectangle slab: plan corners 0.09 W, face-to-side roll-off bevel 0.03 W (4 segments) for the tight rim highlight in refs 1/3.",
    edge={"type": "chamfer", "bevelRadius": BODY["edge"], "segments": 4},
    descriptor={"profile2D": {"points": rect_points(1.0, 1.5, BODY["corner"]), "depth": BODY["t"]},
                "handRefinement": "ExtrudeGeometry bevelEnabled (bevelSize = bevelThickness = 0.03, 4 segments) on the outline inset by 0.03; depth t − 0.06 (generator emits bevelEnabled:false)."},
    anim="root", channels=("translate", "rotate", "visibility", "materialState"), collider="box",
    sockets=[{"id": "front-face", "localPosition": [0, 0, BODY["t"]], "normal": [0, 0, 1]},
             {"id": "keychain-anchor", "localPosition": [LANYARD["x"], -0.75 + LANYARD["above"], FRONT_Z], "normal": [0, -1, 0],
              "notes": "src/device/keychain.ts anchor; X = bar axis"},
             {"id": "card-dock", "localPosition": [0, 0, -0.035], "normal": [0, 0, -1]}],
    features=[feat("edge-rolloff", "bevel", "0.03 W face-to-side radius, 4 segments"),
              feat("plan-corners", "contour", "0.09 W plan-view corner radius"),
              feat("left-roller-slot", "hole", "Dark recess on the -X face behind the exposed roller rim: 0.23 x 0.06 W"),
              feat("right-switch-slot", "hole", "Dark recess on the +X face: 0.1 x 0.04 W at y = 0.475"),
              feat("top-tab-slots", "hole", "Four tab openings in the top face")],
    rec=IRID, importance=1.0, confidence=0.85, evidence=("full-object", "front-ortho")))

C.append(comp(
    "front-glass", "Front cover glass", "macro", "shell", "extrude", (0.94, 1.44, 0.004), (0, 0, FRONT_Z - 0.001), "glass-black",
    role="cover", topo="conforming-shell",
    why="Glass covers the FLAT front face only: the 0.03 W roll-off leaves 0.94 x 1.44 W (corner 0.06 W); a wider plate would overhang the rounded edge (form-refinement finding).",
    descriptor={"profile2D": {"points": rect_points(0.94, 1.44, BODY["corner"] - BODY["edge"]), "depth": 0.004}},
    features=[feat("cover-gloss", "gloss", "Clearcoat 1.0, roughness 0.05: sharp environment reflections across the face")],
    rec=GLASS, importance=0.9))

C.append(comp(
    "display", "E-ink display (CSS3D host)", "macro", "front-glass", "plane-card", (SCREEN["w"], SCREEN["h"], 1),
    (0, SCREEN["cy"], FRONT_Z + 0.0035), "eink-paper", role="display", topo="surface-relief",
    why="Flat matte plane just above the glass; live UI is a CSS3DObject aligned to this plane (360 x 480 CSS px).",
    anim="display", channels=("visibility", "materialState"),
    sockets=[{"id": "css3d-screen", "localPosition": [0, 0, 0.0005], "normal": [0, 0, 1],
              "notes": "CSS3DObject scale = 0.795 / 360 per px"}],
    features=[feat("eink-surface", "decal", "Matte paper #e8e3d6, content from CSS3D HTML; fallback texture when CSS3D is off; corners 0.025 W radius"),
              feat("window-border", "linework", f"Lighter 1 px border: window {WINDOW['w']} x {WINDOW['h']} W at y = {WINDOW['cy']}")],
    rec=PAPER, importance=0.95))

C.append(comp(
    "back-plate", "Back plate", "macro", "shell", "extrude", (0.94, 1.44, 0.003), (0, 0, -FRONT_Z - 0.002), "back-satin",
    role="panel", topo="conforming-shell", why="Inset rear panel (0.03 W from the edge) with a hairline seam to the frame.",
    descriptor={"profile2D": {"points": rect_points(0.94, 1.44, 0.07), "depth": 0.003}},
    features=[feat("logo-emboss", "ridge", "D-star from deanfi.svg, 0.3 W tall, champagne, raised 0.004 W, centred at y = 0.3"),
              feat("studio-text", "linework", "DEAN STUDIO, letter-spaced, engraved at y = -0.64")],
    rec=IRID, importance=0.7))

C.append(comp(
    "key-confirm", "Confirm key (hold)", "meso", "shell", "cylinder", (CONFIRM["r"] * 2, CONFIRM["r"] * 2, 0.014),
    (CONFIRM["x"], CONFIRM["y"], FRONT_Z + 0.004), "champagne-metal", role="button", topo="assembled-solid",
    why="Round key proud of the glass by 0.006 W; D-star engraved on the cap.", edge={"type": "chamfer", "bevelRadius": 0.006, "segments": 3},
    anim="control-press", axis=(0, 0, -1), channels=("translate", "materialState"), collider="cylinder",
    features=[feat("cap", "groove", "Engraved D-star on the cap, 0.09 W"),
              feat("led-ring", "emissive", "Emissive ring fill 0..1 while held (see confirm-led-ring)")],
    rec=CHAMP, attach=axle("shell", "front-face", CONFIRM["r"], 0.014), importance=0.9))

C.append(comp(
    "confirm-led-ring", "Confirm LED ring", "micro", "shell", "torus", (CONFIRM["ring"] * 2, CONFIRM["ring"] * 2, 0.012),
    (CONFIRM["x"], CONFIRM["y"], FRONT_Z + 0.0015), "led-emissive", role="indicator", topo="assembled-solid",
    why="Thin emissive ring set into the glass around the key (TorusGeometry 0.45 scaled to R 0.105; tube 0.006 W).",
    descriptor={"torusTubeRatio": round(0.006 / (0.45 * (CONFIRM["ring"] / 0.45)), 4)},
    scale=[CONFIRM["ring"] / 0.45] * 3, anim="indicator", channels=("materialState", "visibility"), collider="none",
    rec=CHAMP, importance=0.6))

C.append(comp(
    "key-back", "Back key", "meso", "shell", "cylinder", (BACK_KEY["r"] * 2, BACK_KEY["r"] * 2, 0.01),
    (BACK_KEY["x"], BACK_KEY["y"], FRONT_Z + 0.003), "key-polymer", role="button", topo="assembled-solid",
    why="Small round key; chevron glyph engraved.", edge={"type": "chamfer", "bevelRadius": 0.005, "segments": 3},
    anim="control-press", axis=(0, 0, -1), channels=("translate",), collider="cylinder",
    features=[feat("glyph", "groove", "Engraved chevron ‹, 0.04 W")],
    rec=POLY, attach=axle("shell", "front-face", BACK_KEY["r"], 0.01), importance=0.75))

C.append(comp(
    "roller", "Thumb roller", "meso", "shell", "cylinder", (ROLLER["r"] * 2, ROLLER["r"] * 2, ROLLER["t"]),
    (ROLLER["x"], ROLLER["y"], 0), "champagne-metal", role="wheel", topo="assembled-solid",
    why="Disc (axis Z) mostly inside the body; rim protrudes 0.03 W from the -X face giving a 0.2 W visible chord.",
    anim="control-rotate", axis=(0, 0, 1), pivot=(0, 0, 0), channels=("rotate",), collider="cylinder",
    features=[feat("knurl", "ridge", "72 radial ridges around the rim (repetition system roller-knurl)")],
    rec=CHAMP, attach=axle("shell", "left-face", ROLLER["r"], ROLLER["t"], embed=0.15), importance=0.85))

C.append(comp(
    "tabs", "Section tab rail", "meso", "shell", "box", (0.62, 0.004, 0.09), (0, 0.75 + 0.0015, 0), "port-dark",
    role="rail", topo="surface-relief", why="Dark strip on the top face that the four tabs rise from.",
    features=[feat("numerals", "linework", "01 02 03 04 engraved on the top face beside each tab")],
    rec=DARK, importance=0.6))

for i, x in enumerate(TABS_X, start=1):
    active = i == 1
    lift = TAB["h"] / 2 - (0.012 if active else 0)
    C.append(comp(
        f"tab-0{i}", f"Section tab 0{i}", "meso", "tabs", "box", (TAB["w"], TAB["h"], TAB["d"]),
        (x, 0.75 + lift, 0), "champagne-metal" if active else "key-polymer",
        role="button", topo="assembled-solid", why="Rounded key cap rising 0.03 W from the rail; pressed = 0.018 W.",
        edge={"type": "chamfer", "bevelRadius": 0.008, "segments": 3},
        anim="control-press", axis=(0, -1, 0), channels=("translate", "materialState"), collider="box",
        rec=CHAMP if active else POLY, importance=0.8))

C.append(comp(
    "switch-motion", "Motion switch", "meso", "shell", "box", (0.03, 0.06, 0.03), (0.5 + 0.009, SWITCH["y"], 0), "key-polymer",
    role="switch", topo="assembled-solid", why="Slider knob proud of the +X face by 0.024 W, travels ±0.03 W along Y.",
    edge={"type": "chamfer", "bevelRadius": 0.006, "segments": 2},
    anim="control-slide", axis=(0, 1, 0), channels=("translate",), collider="box", rec=POLY, importance=0.6))

C.append(comp(
    "port", "USB-C port", "micro", "shell", "box", (0.15, 0.004, 0.04), (0, -0.75 - 0.0015, 0), "port-dark",
    role="port", topo="surface-relief", why="Stadium-shaped dark opening with a light tongue, centred on the bottom face.",
    features=[feat("usb-c", "hole", "0.15 x 0.04 W stadium opening + 0.09 W tongue")], rec=DARK, importance=0.4))

C.append(comp(
    "lanyard-slot", "Lanyard slot", "micro", "shell", "plane-card", (0.064, 0.088, 1), (LANYARD["x"], -0.75 - 0.0004, 0), "port-dark",
    rot=(HALF_PI, 0, 0), role="slot", topo="surface-relief",
    why="Flush rounded-rect opening with bevel lip (createLanyardSlot in src/device/keychain.ts); the keychain bar sits 0.02 W inside.",
    features=[feat("opening", "hole", "0.056 x 0.08 W opening + 0.004 W lip, within the flat part of the bottom face")],
    rec=DARK, importance=0.6))

C.append(comp(
    "contact-card", "NFC key card (detachable)", "macro", "shell", "box", (0.81, 0.81, 0.02), (0, 0.05, -0.12), "key-card-matte",
    role="card", topo="assembled-solid",
    why=("Dean's NFC key (src/device/keyCard.ts), recovery-key card language in Dean's branding: charcoal matte soft-touch, "
         "four-point-star marks in stepped clusters at the top-left and bottom-right corners, four larger stars framing the centre "
         "(instead of Ledger's bracket corners), DEAN STUDIO engraved; debossed D-star on the back. Details are written inside the "
         "frame. Not in the viewport until the visitor presses Contact me / the wallet's ✓ (Contact sequence, lab/contact.html)."),
    edge={"type": "chamfer", "bevelRadius": 0.01, "segments": 2},
    anim="detachable", channels=("translate", "rotate", "detach", "visibility"), collider="box",
    sockets=[{"id": "css3d-card", "localPosition": [0, 0, 0.0105], "normal": [0, 0, 1], "notes": "320 x 320 CSS px face"}],
    rec=recipe("rgba(22, 23, 27, 1.0)", "rgba(228, 207, 159, 1.0)", "plastic", 0.8), importance=0.7))
C[-1]["actionProfile"]["destruction"]["detachableFragments"] = ["contact-card"]

# Absolute body-frame positions → parent-local (no parent in the tree is rotated).
abs_by_id = {c["id"]: c["_abs"] for c in C}
for c in C:
    if c["parent"]:
        pa = abs_by_id[c["parent"]]
        c["transform"]["position"] = [round(c["_abs"][k] - pa[k], 5) for k in range(3)]
    at = c.get("attachment")
    if at and "_axis" in at:
        ax, h, p = at.pop("_axis"), at.pop("_length") / 2, c["transform"]["position"]
        at["localStart"] = [round(p[k] - ax[k] * h, 5) for k in range(3)]
        at["localEnd"] = [round(p[k] + ax[k] * h, 5) for k in range(3)]
    del c["_abs"]

s["componentTree"] = C

# ---------------------------------------------------------------- materials
def mat(mid, name, mtype, color, rough, metal, *, cls, notes, physical=None, overrides=(), bump=None, emissive=None):
    m = json.loads(json.dumps(MAT_TEMPLATE))  # generator template (captured before any rewrite)
    for k in ("physical", "emissive", "materialClass", "textureless"):
        m.pop(k, None)
    m.update({"id": mid, "name": name, "type": mtype,
              "shaderModel": "MeshPhysicalMaterial" if physical else "MeshStandardMaterial",
              "baseColor": color, "color": color, "materialClass": cls, "notes": notes})
    m["albedo"] = {"dominant": color, "secondary": [color], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}
    m["colorVariation"] = {"palette": [color], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}
    m["roughness"] = {"base": rough, "variation": 0.04, "map": "none" if not bump else "independent-procedural-field", "localResponse": "uniform finish"}
    m["metalness"] = {"base": metal, "variation": 0.0}
    m["wear"] = {"edgeWear": 0.0, "scratches": [], "chips": []}
    m["dirt"] = {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}
    m["localOverrides"] = [dict(o) for o in overrides]
    # Designed, smooth industrial finishes: no grain, print or pores to extract. Declared textureless
    # with evidence instead of inventing texture resolutions/bands the renderer would never read.
    for field in ("normal", "bump", "displacement", "surfaceFrequencyBands", "textureProjection", "textureResolution", "referencePbr"):
        m.pop(field, None)
    m["roughness"]["map"] = "none (uniform finish; variation via clearcoat/iridescence response)"
    m["textureless"] = {
        "declared": True,
        "evidence": [
            "front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px",
            "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels",
        ],
    }
    if physical:
        m["physical"] = physical
    if emissive:
        m["emissive"] = emissive
    return m


s["materials"] = [
    mat("shell-iridescent", "Iridescent graphite (A)", "physical", "#2a2b31", 0.3, 0.8, cls="metal",
        physical={"iridescence": 1.0, "iridescenceIOR": 1.8, "iridescenceThicknessRange": [250, 650], "clearcoat": 0.5, "clearcoatRoughness": 0.2,
                  "fallback": {"color": "#15161a", "metalness": 0.35, "roughness": 0.42, "clearcoat": 0.3, "when": "low GPU tier"}},
        notes="Chosen in lab/materials.html (variant A). Thin-film shifts mauve to teal with view angle; needs a PMREM environment."),
    mat("back-satin", "Iridescent graphite, satin (back)", "physical", "#2a2b31", 0.42, 0.8, cls="metal",
        physical={"iridescence": 0.85, "iridescenceIOR": 1.8, "iridescenceThicknessRange": [250, 650], "clearcoat": 0.2, "clearcoatRoughness": 0.4},
        overrides=[{"id": "back-softtouch", "region": "whole plate", "roughness": 0.46, "notes": "slightly more satin than the frame so the seam reads"}],
        notes="Same film as the frame, satin, so the back panel seam reads."),
    mat("glass-black", "Black cover glass", "physical", "#0b0b0d", 0.05, 0.0, cls="glass",
        physical={"clearcoat": 1.0, "clearcoatRoughness": 0.03, "ior": 1.5},
        overrides=[{"id": "window-border", "region": "display window rim", "color": "#45464d", "notes": "1 px lighter rim"}],
        notes="Opaque black bezel glass; the display sits under a cut window."),
    mat("eink-paper", "E-ink paper", "standard", "#e8e3d6", 0.92, 0.0, cls="plastic",
        notes="Visually unlit (emissive = albedo x 0.85) so the paper reads identically under any key light; CSS3D HTML draws the content."),
    mat("champagne-metal", "Champagne anodized metal", "physical", "#e3c894", 0.24, 1.0, cls="metal",
        physical={"clearcoat": 0.0}, notes="Roller, Confirm, active tab, logo emboss, keychain. Matches LOGO_COLOR family (#f2dfb6)."),
    mat("key-polymer", "Graphite key polymer", "standard", "#26282f", 0.45, 0.1, cls="plastic", notes="Back key, inactive tabs, switch knob."),
    mat("led-emissive", "Confirm LED", "standard", "#e4cf9f", 0.4, 0.0, cls="plastic",
        emissive={"color": "#f2dfb6", "intensityIdle": 0.15, "intensityHeld": 2.2}, notes="Emissive intensity animates with the hold."),
    mat("port-dark", "Recess dark", "standard", "#060607", 0.9, 0.0, cls="plastic", notes="Slots, port and rail cavities."),
    mat("key-card-matte", "Key card matte soft-touch", "physical", "#2a2b30", 0.86, 0.0, cls="plastic",
        physical={"sheen": 0.25, "sheenRoughness": 0.8, "sheenColor": "#3a3b44", "envMapIntensity": 0.8},
        overrides=[{"id": "star-marks", "region": "stepped corner clusters + 4 frame stars", "color": "#55565e", "roughness": 0.43, "notes": "spot-gloss, slightly raised"},
                   {"id": "engraving", "region": "DEAN STUDIO (front, y 0.29) / D-star (back)", "color": "#7a7b83", "roughness": 0.6, "notes": "recessed"}],
        notes="Canvas-generated maps from deanfi.svg paths with seeded soft-touch grain (no image files)."),
]

# ---------------------------------------------------------------- repetition systems
s["repetitionSystems"] = [
    {"id": "roller-knurl", "parent": "roller", "distribution": "radial", "count": 72, "instances": 72, "buildsGeometry": True,
     "geometry": {"primitive": "box", "size": [0.012, 0.006, 0.05]}, "placement": "on rim radius 0.18 W, every 5°",
     "variation": {"scale": 0.0, "rotation": 0.0}, "material": "champagne-metal", "evidenceRefs": ["docs/device-blueprint.html"]},
    {"id": "section-tabs", "parent": "tabs", "distribution": "linear", "count": 4, "instances": 4, "buildsGeometry": True,
     "geometry": {"primitive": "box", "size": [TAB["w"], TAB["h"], TAB["d"]]}, "placement": f"x = {TABS_X}",
     "variation": {"scale": 0.0, "rotation": 0.0}, "material": "key-polymer", "evidenceRefs": ["docs/device-blueprint.html"]},
]

# ---------------------------------------------------------------- framing / evidence
s["coordinateFrame"] = {"front": "+Z (screen)", "up": "+Y", "right": "+X", "units": "W = body width", "scaleReference": "1 W ≈ 54 mm"}
s["silhouette"] = {
    "boundingShape": "rounded-rectangle slab 1 x 1.5 x 0.15 W",
    "aspectRatios": [{"axis": "height/width", "value": 1.5, "source": "measured ref 2 (383/256 px)"},
                     {"axis": "thickness/width", "value": 0.15, "source": "inferred refs 1/3"}],
    "symmetry": "bilateral outline; asymmetric controls (roller -X, switch +X, keys in chin)",
    "dominantCurves": ["0.09 W plan corners", "0.03 W face-to-side roll-off"],
    "negativeSpaces": ["keychain hangs below the bottom edge (not part of the silhouette gate)"],
    "landmarks": ["display window top at 0.082 W below the top", "chin 0.33 W", "Confirm key at (0.30, -0.59)"],
}
s["viewEvidence"] = [
    {"id": "full-object", "view": "front three-quarter (ref 1)", "imageRegion": {"x": 0.28, "y": 0.06, "width": 0.62, "height": 0.9, "units": "normalized"},
     "observations": ["deep glossy bezel", "large portrait display", "soft edge roll-off"], "confidence": 0.85},
    {"id": "front-ortho", "view": "front (ref 2)", "imageRegion": {"x": 0.36, "y": 0.09, "width": 0.56, "height": 0.83, "units": "normalized"},
     "observations": ["H = 1.5 W", "screen 0.79 x 1.07 W", "chin 0.30-0.33 W"], "confidence": 0.9},
    {"id": "blueprint", "view": "design blueprint v0.3", "imageRegion": {"x": 0, "y": 0, "width": 1, "height": 1, "units": "normalized"},
     "observations": ["controls, CMF, keychain, card"], "confidence": 1.0},
]
s["scores"] = {"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2, "primitive_decomposition": 3,
               "material_procedurality": 3, "occlusion_risk": 1, "interaction_fit": 3}
s["referenceCamera"]["note"] = "Form-factor review uses a front three-quarter camera (yaw -0.45, pitch 0.08) matching ref 1; no projection (see projection-route skip)."
s["assumptions"] = [
    "Thickness 0.15 W (refs 1/3 suggest 0.14-0.16 W) and a flat back are design decisions (single-view limit).",
    "USB-C port centred on the bottom edge (design change 7); control side profiles authored from docs/device-blueprint.html v0.3.",
    "Controls, colour/material/finish and branding intentionally differ from the reference (docs/device-design.md); reviews score form factor against the photo and everything else against the blueprint.",
]
s["risks"] = [
    {"id": "css3d-occlusion", "risk": "CSS3D HTML always draws above WebGL; the coin could appear behind the screen text", "mitigation": "keychain hangs below; hide CSS3D when the back faces the camera (backface-visibility)"},
    {"id": "iridescence-cost", "risk": "thin-film shading cost on low-end mobile GPUs", "mitigation": "fallback material C on low tier"},
    {"id": "generator-bevel", "risk": "factory extrude has no bevel", "mitigation": "hand refinement recorded in geometryDescriptor.handRefinement"},
]
s["lightingFromPhoto"] = [
    {"type": "environment", "source": "RoomEnvironment PMREM (sigma 0.04)", "notes": "reflections drive iridescence and glass"},
    {"type": "key", "direction": [-3, 4, 5], "intensity": 1.3, "notes": "upper-left key light, matches ref 1 highlight side"},
    {"type": "rim", "direction": [4, 1, -3], "intensity": 0.8, "color": "#b9a6ff", "notes": "cool rim light separates the dark edge from the page background"},
    {"type": "tone", "notes": "AgX tone mapping, exposure 1.1, sRGB output"},
    {"type": "shadow", "notes": "soft contact shadow (blurred ground-shadow plane / ContactShadows) under the device; no hard shadow maps"},
]
s["animationAnchors"] = [
    "shell root: scroll-driven pose (yaw/pitch/position) per section",
    "tab-01..04: press -Y 0.012 W; active tab champagne",
    "roller: rotate about Z, 5° per list step (one knurl)",
    "key-confirm: press -Z 0.004 W; led ring emissive 0.15 → 2.2 over the hold",
    "key-back: press -Z 0.003 W",
    "switch-motion: slide ±0.03 W along Y",
    "contact-card: slide out -Z then rotate to face camera",
    "keychain-anchor socket: src/device/keychain.ts",
]
s["lookDevTargets"]["qualityPriority"] = "balanced"
s["lookDevTargets"]["qualityPriorityRationale"] = (
    "Surfaces are an ORIGINAL designed CMF (docs/device-design.md, lab/materials.html), deliberately not the "
    "reference's; reference-fidelity texture extraction would import Ledger trade dress. Form factor is still "
    "gated against the photo (Tier-1 silhouette) and every material is declared textureless with evidence."
)
s["performanceBudget"] = {"qualityPriority": "balanced", "targetTriangles": 60000, "maxDrawCalls": 60, "textureSize": 1024, "fpsTarget": 60,
                          "optimizationPolicy": "Merge static meshes per material after the interaction pass; keep animated controls separate."}

# ---------------------------------------------------------------- passes + review targets
ids = [c["id"] for c in C]
s["buildPasses"][0]["componentRefs"] = ["shell", "front-glass", "display", "back-plate"]
for bp in s["buildPasses"][1:]:
    bp["componentRefs"] = ids
s["featureReviewTargets"] = [
    {"id": "overall-silhouette", "name": "Slab proportions 1 : 1.5 : 0.15, plan corners, edge roll-off", "tier": "critical",
     "passIds": ["blockout"], "minimumScore": 0.8, "mustPass": True, "componentRefs": ["shell"], "evidenceRefs": ["front-ortho", "full-object"]},
    {"id": "face-layout", "name": "Bezel / display window / chin proportions", "tier": "critical",
     "passIds": ["blockout", "structural-pass"], "minimumScore": 0.8, "mustPass": True, "componentRefs": ["front-glass", "display"], "evidenceRefs": ["front-ortho"]},
    {"id": "control-set", "name": "Controls placed per blueprint (tabs, roller, keys, switch)", "tier": "critical",
     "passIds": ["structural-pass", "form-refinement"], "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["tab-01", "tab-02", "tab-03", "tab-04", "roller", "key-confirm", "key-back", "switch-motion"], "evidenceRefs": ["blueprint"]},
    {"id": "reference-material-system", "name": "Iridescent shell, black glass, e-ink, champagne accents", "tier": "critical",
     "passIds": ["material-pass", "surface-pass"], "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["shell", "front-glass", "display", "key-confirm"], "evidenceRefs": ["blueprint", "full-object"]},
    {"id": "underside-details", "name": "Port, lanyard slot, back emboss", "tier": "important",
     "passIds": ["form-refinement", "surface-pass"], "minimumScore": 0.65, "mustPass": False,
     "componentRefs": ["port", "lanyard-slot", "back-plate"], "evidenceRefs": ["blueprint"]},
]

P.write_text(json.dumps(s, indent=2, ensure_ascii=False), encoding="utf-8")
print("spec authored:", len(C), "components,", len(s["materials"]), "materials")
