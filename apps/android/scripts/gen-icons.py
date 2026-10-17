#!/usr/bin/env python3
"""Генерирует иконки NYKISS Gram для Android: золотая «N» на фетре.

Источник правды — геометрия N ниже. Скрипт пишет:
  - векторы (adaptive icon, monochrome, splash) в res/drawable
  - PNG для Android < 8 (mipmap-*dpi/ic_launcher*.png)
  - store-icon-512.png (для раздачи/превью)

Зависимость: Pillow (python3 -m pip install pillow). Результат закоммичен,
для обычной сборки APK скрипт запускать не нужно.
"""
from pathlib import Path
from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / "app/src/main/res"

# N в координатах 108x108 (adaptive-icon viewport), внутри safe-zone 66x66 по центру.
N_POINTS = [(33, 30), (44, 30), (65, 62), (65, 30), (75, 30),
            (75, 78), (64, 78), (43, 46), (43, 78), (33, 78)]
GOLD = ["#F6E2A3", "#D2A94F", "#8C6620"]  # светлый -> тёмный (сверху вниз)
FELT_CENTER, FELT_EDGE = "#14301F", "#070807"


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def path_data():
    pts = N_POINTS
    return "M{},{} ".format(*pts[0]) + " ".join("L{},{}".format(*p) for p in pts[1:]) + " Z"


def write_vectors():
    d = RES / "drawable"
    d.mkdir(parents=True, exist_ok=True)
    fg = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="{path_data()}">
        <aapt:attr name="android:fillColor">
            <gradient
                android:startX="54" android:startY="30"
                android:endX="54" android:endY="78"
                android:type="linear">
                <item android:offset="0" android:color="{GOLD[0]}" />
                <item android:offset="0.5" android:color="{GOLD[1]}" />
                <item android:offset="1" android:color="{GOLD[2]}" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
"""
    bg = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:centerX="54" android:centerY="48"
                android:gradientRadius="76"
                android:type="radial">
                <item android:offset="0" android:color="{FELT_CENTER}" />
                <item android:offset="1" android:color="{FELT_EDGE}" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
"""
    mono = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="{path_data()}" />
</vector>
"""
    (d / "ic_launcher_foreground.xml").write_text(fg)
    (d / "ic_launcher_background.xml").write_text(bg)
    (d / "ic_launcher_monochrome.xml").write_text(mono)
    # для сплэша берём тот же золотой знак
    (d / "splash_icon.xml").write_text(fg)


def render(size, shape):
    """shape: 'round' | 'squircle' | 'square'. Рисуем в 4x и уменьшаем."""
    k = 4
    s = size * k
    # фон-фетр: радиальный градиент
    bg = Image.new("RGB", (s, s), hex_rgb(FELT_EDGE))
    px = bg.load()
    cx, cy, rad = s * 0.5, s * 0.44, s * 0.70
    c0, c1 = hex_rgb(FELT_CENTER), hex_rgb(FELT_EDGE)
    for y in range(s):
        for x in range(s):
            t = min(1.0, (((x - cx) ** 2 + (y - cy) ** 2) ** 0.5) / rad)
            px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    # золотая N с вертикальным градиентом
    scale = s / 108.0
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).polygon([(x * scale, y * scale) for x, y in N_POINTS], fill=255)
    grad = Image.new("RGB", (s, s))
    gp = grad.load()
    stops = [hex_rgb(g) for g in GOLD]
    y0, y1 = 30 * scale, 78 * scale
    for y in range(s):
        t = min(1.0, max(0.0, (y - y0) / (y1 - y0)))
        if t < 0.5:
            a, b, u = stops[0], stops[1], t / 0.5
        else:
            a, b, u = stops[1], stops[2], (t - 0.5) / 0.5
        col = tuple(int(a[i] + (b[i] - a[i]) * u) for i in range(3))
        for x in range(s):
            gp[x, y] = col
    bg.paste(grad, (0, 0), mask)
    out = bg.convert("RGBA")
    # форма иконки (legacy: ОС не маскирует)
    m = Image.new("L", (s, s), 0)
    dr = ImageDraw.Draw(m)
    if shape == "round":
        dr.ellipse((0, 0, s - 1, s - 1), fill=255)
    elif shape == "squircle":
        dr.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=255)
    else:
        dr.rectangle((0, 0, s, s), fill=255)
    out.putalpha(m)
    return out.resize((size, size), Image.LANCZOS)


def main():
    write_vectors()
    for dpi, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        d = RES / f"mipmap-{dpi}"
        d.mkdir(parents=True, exist_ok=True)
        render(px, "squircle").save(d / "ic_launcher.png", optimize=True)
        render(px, "round").save(d / "ic_launcher_round.png", optimize=True)
    # N на 108-сетке шире safe-zone в legacy-иконке; это нормально — ОС ничего не режет
    render(512, "squircle").save(Path(__file__).resolve().parent.parent / "store-icon-512.png", optimize=True)
    print("ok")


if __name__ == "__main__":
    main()
