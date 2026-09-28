"""Migrate DeanFi2 content + media into DeanFi3 (one source of truth).

- Merges DeanFi2 src/content.json with the runtime overrides in src/data.ts (project order, confirmed
  per-project tools, improved descriptions) into src/content/portfolio.json.
- Copies project screenshots, chronicle photos, tool logos and language flags into public/.
- Builds 1-bit dithered previews for the wallet's e-ink screen (public/media/eink/<id>.png).

Run: python scripts/migrate_content.py
"""
import json
import re
import shutil
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT.parent / "DeanFi2"
PUB = ROOT / "public"

ORDER = ["eni", "aseanlabs", "kairma", "paygo", "eniaclabs", "fortuna", "nikola", "flowfi", "pusc", "ait"]
EINK_SIZE = (162, 75)  # 1 dot = 2 CSS px on the 324 × 150 preview well of the 360 × 480 screen


def ts_object(src: str, name: str) -> dict:
    """Pull a `const name ... = { key: 'value', ... }` object literal out of data.ts."""
    body = re.search(rf"const {name}[^=]*=\s*\{{(.*?)\n\}};", src, re.S).group(1)
    out = {}
    for m in re.finditer(r"^\s*'?([\w-]+)'?\s*:\s*(.+?),?\s*$", body, re.M):
        key, val = m.group(1), m.group(2).rstrip(",")
        if val.startswith("["):
            out[key] = re.findall(r"'([^']+)'", val)
        else:
            out[key] = val.strip()[1:-1].replace("\\'", "'")
    return out


def dither(src: Path, dst: Path) -> None:
    im = ImageOps.exif_transpose(Image.open(src)).convert("L")
    im = ImageOps.fit(im, (EINK_SIZE[0] * 4, EINK_SIZE[1] * 4), Image.LANCZOS, centering=(0.5, 0.35))
    im = ImageOps.autocontrast(im, cutoff=1)
    im = ImageEnhance.Contrast(im).enhance(1.15)
    im = im.resize(EINK_SIZE, Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=80))
    dots = im.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    dots.resize((EINK_SIZE[0] * 2, EINK_SIZE[1] * 2), Image.NEAREST).save(dst, optimize=True)


def main() -> None:
    content = json.loads((OLD / "src/content.json").read_text(encoding="utf-8"))
    data_ts = (OLD / "src/data.ts").read_text(encoding="utf-8")
    tools = ts_object(data_ts, "projectSoftware")
    project_copy = ts_object(data_ts, "projectCopy")
    event_copy = ts_object(data_ts, "improved")

    (PUB / "media/projects").mkdir(parents=True, exist_ok=True)
    (PUB / "media/chronicle").mkdir(parents=True, exist_ok=True)
    (PUB / "media/eink").mkdir(parents=True, exist_ok=True)

    projects = []
    for p in sorted(content["projects"], key=lambda p: ORDER.index(p["id"])):
        images = []
        for i, img in enumerate(p["images"], start=1):
            dst = f"/media/projects/{p['id']}-{i}.webp"
            shutil.copy(OLD / "public" / img.lstrip("/"), PUB / dst.lstrip("/"))
            images.append(dst)
        dither(PUB / images[0].lstrip("/"), PUB / f"media/eink/{p['id']}.png")
        projects.append({
            "id": p["id"], "title": p["title"], "category": p["subtitle"], "roles": p["roles"],
            "tools": tools[p["id"]], "stack": p["stack"], "tags": p["tags"], "status": p["status"],
            "link": p["link"], "description": project_copy.get(p["id"], p["description"]),
            "images": images, "eink": f"/media/eink/{p['id']}.png",
        })

    events = []
    for e in content["events"]:
        images = []
        for img in e["images"]:
            name = Path(img).name
            shutil.copy(OLD / "public" / img.lstrip("/"), PUB / "media/chronicle" / name)
            images.append(f"/media/chronicle/{name}")
        dither(PUB / images[0].lstrip("/"), PUB / f"media/eink/{e['id']}.png")
        events.append({
            "id": e["id"], "title": e["title"], "role": e["role"], "place": e["place"], "country": e["country"],
            "description": event_copy.get(e["id"], e["description"]), "images": images, "eink": f"/media/eink/{e['id']}.png",
        })

    for folder in ("tool-logos", "flags"):
        (PUB / "media" / folder).mkdir(parents=True, exist_ok=True)
        for f in (OLD / "public/assets" / folder).iterdir():
            shutil.copy(f, PUB / "media" / folder / f.name)

    out = {"projects": projects, "events": events}
    (ROOT / "src/content/portfolio.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{len(projects)} projects, {len(events)} events")
    for p in projects:
        print(" ", p["id"], p["roles"], p["tools"])


if __name__ == "__main__":
    main()
