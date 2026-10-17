#!/usr/bin/env python3
"""Generates build/icon.png (1024), icon.ico and icon.icns: golden N on felt #070807.
Needs Pillow; on macOS .icns is built with iconutil. Run: npm run icons"""
import os, shutil, subprocess, sys
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
S = 4096  # supersample, downscaled to 1024
BG = (7, 8, 7)
GOLD_TOP = (233, 200, 96)   # #e9c860
GOLD_BOT = (201, 162, 39)   # #C9A227

def master():
  img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
  d = ImageDraw.Draw(img)
  # macOS-like squircle margin: art occupies ~82% of the canvas
  m = int(S * 0.09)
  d.rounded_rectangle([m, m, S - m, S - m], radius=int(S * 0.19), fill=BG + (255,))
  # thin inner gold hairline
  w = int(S * 0.004)
  inset = m + int(S * 0.025)
  d.rounded_rectangle([inset, inset, S - inset, S - inset], radius=int(S * 0.165),
                      outline=(74, 62, 20, 255), width=w)
  # the N as one polygon: left stem, diagonal, right stem
  x0, x1 = S * 0.31, S * 0.69
  y0, y1 = S * 0.27, S * 0.73
  t = S * 0.085  # stem thickness
  poly = [
    (x0, y0), (x0 + t * 1.15, y0), (x1 - t, y1 - (y1 - y0) * 0.22),
    (x1 - t, y0), (x1, y0), (x1, y1), (x1 - t * 1.15, y1),
    (x0 + t, y0 + (y1 - y0) * 0.22), (x0 + t, y1), (x0, y1)
  ]
  mask = Image.new('L', (S, S), 0)
  ImageDraw.Draw(mask).polygon(poly, fill=255)
  grad = Image.new('RGBA', (S, S))
  gd = ImageDraw.Draw(grad)
  top, bot = int(y0), int(y1)
  for y in range(S):
    k = min(max((y - top) / max(bot - top, 1), 0), 1)
    c = tuple(int(GOLD_TOP[i] + (GOLD_BOT[i] - GOLD_TOP[i]) * k) for i in range(3))
    gd.line([(0, y), (S, y)], fill=c + (255,))
  img.paste(grad, (0, 0), mask)
  return img.resize((1024, 1024), Image.LANCZOS)

def main():
  os.makedirs(OUT, exist_ok=True)
  img = master()
  img.save(os.path.join(OUT, 'icon.png'))
  img.save(os.path.join(OUT, 'icon.ico'), sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
  if sys.platform == 'darwin' and shutil.which('iconutil'):
    iconset = os.path.join(OUT, 'icon.iconset')
    shutil.rmtree(iconset, ignore_errors=True)
    os.makedirs(iconset)
    for s in (16, 32, 128, 256, 512):
      img.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
      img.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
    subprocess.check_call(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(OUT, 'icon.icns')])
    shutil.rmtree(iconset)
  else:
    print('skip .icns (needs macOS iconutil); keep the committed build/icon.icns')

main()
