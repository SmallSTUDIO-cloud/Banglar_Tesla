#!/usr/bin/env python3
"""Render a deterministic, source-attributed schematic minimap from imported OSM JSON."""
from __future__ import annotations

import argparse
import binascii
import json
import math
import struct
import zlib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "unity/Assets/BanglarTesla/Data/Maps/mohammadpur.osm.json"
DEFAULT_OUTPUT = ROOT / "unity/Assets/BanglarTesla/Resources/UI/mohammadpur-minimap.png"
Color = tuple[int, int, int, int]


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)


def encode_png(width: int, height: int, pixels: bytearray) -> bytes:
    rows = b"".join(b"\0" + bytes(pixels[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + png_chunk(b"IDAT", zlib.compress(rows, 9)) + png_chunk(b"IEND", b""))


class Canvas:
    def __init__(self, size: int):
        self.size = size
        self.pixels = bytearray(size * size * 4)

    def blend(self, x: int, y: int, color: Color) -> None:
        if not (0 <= x < self.size and 0 <= y < self.size) or color[3] <= 0:
            return
        offset = (y * self.size + x) * 4
        alpha = color[3] / 255.0
        inverse = 1.0 - alpha
        old_alpha = self.pixels[offset + 3] / 255.0
        output_alpha = alpha + old_alpha * inverse
        if output_alpha <= 0:
            return
        for channel in range(3):
            old = self.pixels[offset + channel] / 255.0
            value = (color[channel] / 255.0 * alpha + old * old_alpha * inverse) / output_alpha
            self.pixels[offset + channel] = round(max(0, min(1, value)) * 255)
        self.pixels[offset + 3] = round(output_alpha * 255)

    def disc(self, cx: float, cy: float, radius: float, color: Color) -> None:
        x0, x1 = math.floor(cx - radius), math.ceil(cx + radius)
        y0, y1 = math.floor(cy - radius), math.ceil(cy + radius)
        rr = radius * radius
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= rr:
                    self.blend(x, y, color)

    def line(self, a: tuple[float, float], b: tuple[float, float], width: float, color: Color) -> None:
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        if length_sq < 1e-9:
            self.disc(ax, ay, width / 2, color)
            return
        radius = width / 2
        x0, x1 = math.floor(min(ax, bx) - radius), math.ceil(max(ax, bx) + radius)
        y0, y1 = math.floor(min(ay, by) - radius), math.ceil(max(ay, by) + radius)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_sq))
                px, py = ax + dx * t, ay + dy * t
                if (x - px) ** 2 + (y - py) ** 2 <= radius * radius:
                    self.blend(x, y, color)


def road_style(road: dict[str, Any]) -> tuple[float, Color]:
    highway = road.get("highway", "")
    if highway in {"primary", "trunk"}:
        return 5.0, (224, 190, 119, 235)
    if highway in {"secondary", "tertiary"}:
        return 4.0, (195, 183, 139, 230)
    if highway in {"residential", "living_street", "unclassified"}:
        return 2.6, (143, 166, 153, 220)
    if road.get("driveable"):
        return 1.8, (107, 136, 122, 190)
    return 1.2, (76, 104, 93, 130)


def render_minimap(dataset: dict[str, Any], size: int = 1024) -> bytes:
    if size < 128 or size > 4096:
        raise ValueError("Minimap size must be between 128 and 4096")
    canvas = Canvas(size)
    origin = dataset["origin"]
    bounds = dataset["bounds"]
    longitude_scale = math.cos(math.radians(origin["lat"]))

    def raw(point: dict[str, float]) -> tuple[float, float]:
        return ((point["lon"] - origin["lon"]) * longitude_scale, point["lat"] - origin["lat"])

    corners = [
        raw({"lat": bounds["south"], "lon": bounds["west"]}), raw({"lat": bounds["south"], "lon": bounds["east"]}),
        raw({"lat": bounds["north"], "lon": bounds["west"]}), raw({"lat": bounds["north"], "lon": bounds["east"]}),
    ]
    min_x, max_x = min(p[0] for p in corners), max(p[0] for p in corners)
    min_y, max_y = min(p[1] for p in corners), max(p[1] for p in corners)
    margin = size * 0.045
    scale = min((size - margin * 2) / (max_x - min_x), (size - margin * 2) / (max_y - min_y))
    offset_x = (size - (max_x - min_x) * scale) / 2
    offset_y = (size - (max_y - min_y) * scale) / 2

    def project(point: dict[str, float]) -> tuple[float, float]:
        x, y = raw(point)
        return (offset_x + (x - min_x) * scale, size - offset_y - (y - min_y) * scale)

    # Non-drivable geometry first, then drivable roads with a dark casing for legibility.
    for pass_index in range(2):
        for road in dataset["roads"]:
            if bool(road.get("driveable")) != bool(pass_index):
                continue
            points = [project(point) for point in road["geometry"]]
            width, color = road_style(road)
            for a, b in zip(points, points[1:]):
                if pass_index:
                    canvas.line(a, b, width + 2.0, (5, 22, 19, 205))
                canvas.line(a, b, width, color)

    boundary = [project(point) for point in dataset["boundary"]]
    for a, b in zip(boundary, boundary[1:]):
        canvas.line(a, b, 6.0, (5, 22, 19, 225))
        canvas.line(a, b, 2.6, (224, 177, 83, 235))

    # Gameplay boundary exits are deliberately distinct from real-world barrier evidence.
    for exit_data in dataset.get("boundaryExits", []):
        x, y = project(exit_data["point"])
        canvas.disc(x, y, 2.4, (190, 63, 55, 235))

    # Only specific source IDs receive landmark markers; no guessed positions.
    landmark_colors = {
        13990591896: (84, 206, 180, 255),  # Chanmia Housing neighbourhood node
        223068917: (239, 190, 88, 255),   # Town Hall Market way
        367368960: (239, 190, 88, 255),   # Agricultural Kacha Bazar way
    }
    for poi in dataset["pois"]:
        color = landmark_colors.get(poi["id"])
        if color:
            x, y = project(poi["center"])
            canvas.disc(x, y, 6.0, (5, 22, 19, 235))
            canvas.disc(x, y, 3.6, color)
    return encode_png(size, size, canvas.pixels)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()
    dataset = json.loads(args.input.read_text(encoding="utf-8"))
    payload = render_minimap(dataset, args.size)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(f"Wrote {args.output} ({len(payload):,} bytes, {args.size}x{args.size})")


if __name__ == "__main__":
    main()
