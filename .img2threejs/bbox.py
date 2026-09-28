"""Framing helper: object bbox (pixel aspect, height fraction, centre) for reference vs render.
Usage: python .img2threejs/bbox.py <img> [<img> ...]"""
import sys
import numpy as np
from PIL import Image

for p in sys.argv[1:]:
    a = np.asarray(Image.open(p).convert("RGB")).astype(int)
    m = np.abs(a - a[2, 2]).sum(2) > 40
    ys, xs = np.where(m)
    h, w = m.shape
    print(f"{p}: aspect={(xs.max()-xs.min())/(ys.max()-ys.min()):.3f} hfrac={(ys.max()-ys.min())/h:.3f} "
          f"cx={(xs.min()+xs.max())/2/w:.3f} cy={(ys.min()+ys.max())/2/h:.3f}")
