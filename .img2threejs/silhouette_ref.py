"""Hole-filled silhouette of references/wallet/1.png for Tier-1 silhouette gates.

Why: the reference's e-ink screen (~#d6d6d4) is close to the photo background (#f7f7f7), so a
background-difference mask punches a hole where the screen is, and a solid render is penalised for
the object's own screen. Flood-filling the background from the image border and treating
everything not reached as object recovers the true outline. Geometry is untouched: only the mask
extraction artifact is corrected. The photo itself stays the reference for AI-vision comparison sheets.
Output: .img2threejs/analysis/ref1-silhouette.png (object = near-black, background = photo bg).
"""
from collections import deque
import numpy as np
from PIL import Image

src = np.asarray(Image.open("references/wallet/1.png").convert("RGB")).astype(int)
h, w, _ = src.shape
bg = src[2, 2]
near_bg = np.abs(src - bg).sum(2) <= 18  # background-like pixels
seen = np.zeros((h, w), bool)
q = deque([(y, x) for x in range(w) for y in (0, h - 1)] + [(y, x) for y in range(h) for x in (0, w - 1)])
while q:
    y, x = q.popleft()
    if seen[y, x] or not near_bg[y, x]:
        continue
    seen[y, x] = True
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
            q.append((ny, nx))
out = np.zeros_like(src)
out[:] = bg
out[~seen] = (20, 20, 22)
Image.fromarray(out.astype(np.uint8)).save(".img2threejs/analysis/ref1-silhouette.png")
print("object fraction", round((~seen).mean(), 3))
