"""Build the About portrait assets from `dean 2.jpeg` (1:1 stage photo).

Outputs (public/media/):
  dean-portrait.webp        colour 4:5 crop, used in the popup / list view
  dean-portrait-eink.png    1-bit dithered 4:5 crop, used on the e-ink device screen

Run: python scripts/media/portrait.py
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "dean 2.jpeg"
OUT = ROOT / "public" / "media"

# 4:5 crop in source pixels: head to waist, keeps the mic and the gesturing hand.
CROP = (251, 21, 1003, 961)  # 752 x 940
EINK_SIZE = (120, 150)       # one dither dot = one CSS px of the 360x480 screen


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    im = ImageOps.exif_transpose(Image.open(SRC)).convert("RGB").crop(CROP)

    im.resize((800, 1000), Image.LANCZOS).save(OUT / "dean-portrait.webp", quality=82, method=6)

    # Stage light is dark and low-contrast; lift mids before dithering so the face survives.
    g = ImageOps.grayscale(im)
    g = ImageOps.autocontrast(g, cutoff=1)
    g = g.point(lambda v: int(255 * (v / 255) ** 0.72))
    g = ImageEnhance.Contrast(g).enhance(1.25)
    g = g.resize(EINK_SIZE, Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=90))
    dots = g.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    dots.resize((EINK_SIZE[0] * 2, EINK_SIZE[1] * 2), Image.NEAREST).save(OUT / "dean-portrait-eink.png", optimize=True)


if __name__ == "__main__":
    main()
