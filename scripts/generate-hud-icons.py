#!/usr/bin/env python3
"""Generate Banglar Tesla's original transparent HUD icons with stdlib rasterization."""
from __future__ import annotations

import importlib.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts/render-mohammadpur-minimap.py"
SPEC = importlib.util.spec_from_file_location("minimap_raster", MODULE_PATH)
assert SPEC and SPEC.loader
raster = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(raster)
OUTPUT = ROOT / "unity/Assets/BanglarTesla/Resources/UI/Icons"
Color = tuple[int, int, int, int]
WHITE = (239, 244, 229, 255)
BRASS = (246, 193, 91, 255)
CYAN = (85, 225, 218, 255)
RED = (255, 107, 91, 255)
TEAL = (92, 216, 176, 255)


def lines(canvas, points, width, color):
    for a, b in zip(points, points[1:]):
        canvas.line(a, b, width, color)


def circle(canvas, cx, cy, radius, width, color):
    points = [(cx + math.cos(i * math.tau / 64) * radius, cy + math.sin(i * math.tau / 64) * radius) for i in range(65)]
    lines(canvas, points, width, color)


def polygon(canvas, points, color):
    min_x, max_x = math.floor(min(p[0] for p in points)), math.ceil(max(p[0] for p in points))
    min_y, max_y = math.floor(min(p[1] for p in points)), math.ceil(max(p[1] for p in points))
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            inside = False
            j = len(points) - 1
            for i in range(len(points)):
                ax, ay = points[i]
                bx, by = points[j]
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    inside = not inside
                j = i
            if inside:
                canvas.blend(x, y, color)


def draw_icon(name: str, size: int = 128) -> bytes:
    canvas = raster.Canvas(size)
    s = size / 128.0

    def pts(values):
        return [(x * s, y * s) for x, y in values]

    color = {"brake": RED, "turbo": CYAN, "pedal": BRASS, "horn": BRASS, "blacklist": BRASS, "context": TEAL}.get(name, WHITE)
    if name in {"steer-left", "steer-right"}:
        values = [(78, 28), (42, 64), (78, 100)] if name == "steer-left" else [(50, 28), (86, 64), (50, 100)]
        lines(canvas, pts(values), 13 * s, color)
    elif name == "pedal":
        polygon(canvas, pts([(43, 18), (85, 18), (94, 108), (34, 108)]), color)
        polygon(canvas, pts([(49, 26), (79, 26), (86, 99), (42, 99)]), (16, 55, 45, 255))
        for y in (43, 61, 79):
            lines(canvas, pts([(49, y), (79, y)]), 7 * s, color)
    elif name == "brake":
        ring = [(45, 17), (83, 17), (111, 45), (111, 83), (83, 111), (45, 111), (17, 83), (17, 45), (45, 17)]
        lines(canvas, pts(ring), 8 * s, color)
        lines(canvas, pts([(64, 38), (64, 69)]), 10 * s, color)
        canvas.disc(64 * s, 88 * s, 6 * s, color)
    elif name == "turbo":
        polygon(canvas, pts([(72, 8), (29, 70), (55, 70), (45, 120), (101, 50), (70, 50)]), color)
    elif name == "horn":
        polygon(canvas, pts([(18, 50), (42, 50), (79, 25), (79, 96), (42, 73), (18, 73)]), color)
        polygon(canvas, pts([(34, 75), (51, 75), (58, 106), (43, 106)]), color)
        lines(canvas, pts([(93, 45), (108, 34)]), 7 * s, color)
        lines(canvas, pts([(96, 63), (116, 63)]), 7 * s, color)
        lines(canvas, pts([(93, 80), (108, 92)]), 7 * s, color)
    elif name == "pause":
        lines(canvas, pts([(45, 28), (45, 100)]), 18 * s, color)
        lines(canvas, pts([(83, 28), (83, 100)]), 18 * s, color)
    elif name == "camera":
        lines(canvas, pts([(20, 43), (43, 43), (52, 29), (78, 29), (87, 43), (110, 43), (110, 99), (20, 99), (20, 43)]), 8 * s, color)
        circle(canvas, 65 * s, 70 * s, 21 * s, 8 * s, color)
    elif name == "blacklist":
        polygon(canvas, pts([(32, 20), (96, 20), (88, 65), (73, 79), (55, 79), (40, 65)]), color)
        polygon(canvas, pts([(43, 30), (85, 30), (79, 57), (68, 68), (60, 68), (49, 57)]), (20, 47, 40, 255))
        lines(canvas, pts([(32, 31), (16, 31), (20, 58), (43, 64)]), 7 * s, color)
        lines(canvas, pts([(96, 31), (112, 31), (108, 58), (85, 64)]), 7 * s, color)
        lines(canvas, pts([(64, 78), (64, 101)]), 9 * s, color)
        lines(canvas, pts([(42, 108), (86, 108)]), 11 * s, color)
    elif name == "context":
        canvas.disc(50 * s, 35 * s, 15 * s, color)
        lines(canvas, pts([(50, 54), (50, 91)]), 12 * s, color)
        lines(canvas, pts([(29, 69), (71, 69)]), 10 * s, color)
        lines(canvas, pts([(82, 48), (108, 48), (96, 36)]), 7 * s, color)
        lines(canvas, pts([(108, 48), (96, 60)]), 7 * s, color)
    else:
        raise ValueError(f"Unknown icon: {name}")
    return raster.encode_png(size, size, canvas.pixels)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in ("steer-left", "steer-right", "pedal", "brake", "turbo", "horn", "pause", "camera", "blacklist", "context"):
        payload = draw_icon(name)
        path = OUTPUT / f"{name}.png"
        path.write_bytes(payload)
        print(f"{path.relative_to(ROOT)}: {len(payload)} bytes")


if __name__ == "__main__":
    main()
