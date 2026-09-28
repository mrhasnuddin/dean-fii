"""Tier-1 proxy: IoU, bbox aspect delta and bbox-area scale delta (same formulas as
diagnose_render.py, 224 grid) of renders vs the hole-filled reference silhouette.
Usage: python .img2threejs/iou.py <render.png> [...]   (prints OK when all three pass)"""
import sys
import numpy as np
from PIL import Image


def mask(p, n=224):
    a = np.asarray(Image.open(p).convert("RGB").resize((n, n))).astype(int)
    return np.abs(a - a[2, 2]).sum(2) > 40


def bbox(m):
    ys, xs = np.where(m)
    return xs.max() - xs.min() + 1, ys.max() - ys.min() + 1


ref = mask(".img2threejs/analysis/ref1-silhouette.png")
rw, rh = bbox(ref)
for p in sys.argv[1:]:
    m = mask(p)
    iou = (ref & m).sum() / (ref | m).sum()
    w, h = bbox(m)
    ar = abs(rw / rh - w / h) / (rw / rh)
    sc = abs(rw * rh - w * h) / (rw * rh)
    ok = iou >= 0.85 and ar <= 0.05 and sc <= 0.08
    print(f"{p}: IoU={iou:.3f} aspectΔ={ar:.3f} scaleΔ={sc:.3f} {'OK' if ok else ''}")
