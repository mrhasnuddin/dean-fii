"""Add a project's media from two screenshots: the two 1280x800 WebP thumbnails and the 1-bit dithered
preview for the wallet's e-ink screen (same recipe as scripts/migrate_content.py).

Outputs (public/media/):
  projects/<id>-1.webp, projects/<id>-2.webp   1280x800, for the popup and list view
  eink/<id>.png                                324x150, 1-bit, dithered from the screenshot given as EINK_FROM (1 or 2)

Run: python scripts/media/project_media.py <id> <shot1.png> <shot2.png> [eink_from=1]
More thumbnails for a project that already has two (numbered on from -3; the dithered image is left alone):
     python scripts/media/project_media.py <id> --more <shot3.png> [<shot4.png> ...]
"""
import sys
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "media"
EINK_SIZE = (162, 75)  # 1 dot = 2 CSS px on the 324 x 150 preview well of the 360 x 480 screen (saved at 2x)


def more(pid: str, shots: list[str]) -> None:
    (PUB / "projects").mkdir(parents=True, exist_ok=True)
    first = len(list((PUB / "projects").glob(f"{pid}-*.webp"))) + 1
    for i, p in enumerate(shots, first):
        im = ImageOps.fit(Image.open(p).convert("RGB"), (1280, 800), Image.LANCZOS)
        im.save(PUB / "projects" / f"{pid}-{i}.webp", quality=82, method=6)


def main() -> None:
    if len(sys.argv) > 3 and sys.argv[2] == "--more":
        return more(sys.argv[1], sys.argv[3:])
    pid, a, b = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    src = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    (PUB / "projects").mkdir(parents=True, exist_ok=True)
    shots = [Image.open(p).convert("RGB") for p in (a, b)]
    for i, im in enumerate(shots, 1):
        ImageOps.fit(im, (1280, 800), Image.LANCZOS).save(PUB / "projects" / f"{pid}-{i}.webp", quality=82, method=6)
    im = ImageOps.grayscale(shots[src - 1])
    im = ImageOps.fit(im, (EINK_SIZE[0] * 4, EINK_SIZE[1] * 4), Image.LANCZOS, centering=(0.5, 0.35))
    im = ImageOps.autocontrast(im, cutoff=1)
    im = ImageEnhance.Contrast(im).enhance(1.15)
    im = im.resize(EINK_SIZE, Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=80))
    dots = im.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    dots.resize((EINK_SIZE[0] * 2, EINK_SIZE[1] * 2), Image.NEAREST).save(PUB / "eink" / f"{pid}.png", optimize=True)


if __name__ == "__main__":
    main()
