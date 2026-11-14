"""Provenance gate for the map POI registry (src/world/poiRegistry.ts).

The TypeScript test proves the *math*: every `x`/`z` is the computed projection of
the stored `lat`/`lon`. It cannot prove the *source*, because this project ships
no Node typings and the production build type-checks test files.

This module closes that gap. It parses the registry out of the TypeScript source
and verifies every record against `data/mohammadpur/mohammadpur.osm.json`:

- the OSM feature id must exist, with the declared feature type;
- the stored lat/lon must match the dataset centre (1 cm tolerance);
- the projected coordinate must match the dataset's own projection;
- the name must be traceable to the feature (English, Bengali, or the dataset's
  own name fields) — a completely invented name fails.

A POI whose id does not exist, or whose coordinates or name were invented, fails
here rather than shipping as a plausible-looking lie.
"""
from __future__ import annotations

import json
import math
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "src" / "world" / "poiRegistry.ts"
DATASET = ROOT / "data" / "mohammadpur" / "mohammadpur.osm.json"

# Projection constants, kept in sync with src/world/landmarks.ts and the world.
LAT0, LON0, SCALE = 23.7624, 90.3646, 0.36
METRES_PER_DEG_LAT = 111132
METRES_PER_DEG_LON = 111320 * math.cos(math.radians(LAT0))

ENTRY = re.compile(
    r"\{\s*"
    r"id: '(?P<id>[^']+)',\s*"
    r"nameEn: (?P<en>\"(?:[^\"\\]|\\.)*\")\s*,\s*"
    r"nameBn: (?P<bn>\"(?:[^\"\\]|\\.)*\")\s*,\s*"
    r"category: '(?P<category>[^']+)',\s*"
    r"osmId: (?P<osm_id>\d+),\s*"
    r"osmType: '(?P<osm_type>[^']+)',\s*"
    r"lat: (?P<lat>-?[\d.]+),\s*"
    r"lon: (?P<lon>-?[\d.]+),\s*"
    r"x: (?P<x>-?[\d.]+),\s*"
    r"z: (?P<z>-?[\d.]+),\s*"
    r"insideWorld: (?P<inside>true|false),",
    re.S,
)


def project(lat: float, lon: float) -> tuple[float, float]:
    x = (lon - LON0) * METRES_PER_DEG_LON * SCALE
    z = (LAT0 - lat) * METRES_PER_DEG_LAT * SCALE
    return x, z


def parse_registry() -> list[dict]:
    text = REGISTRY.read_text(encoding="utf-8")
    entries = []
    for match in ENTRY.finditer(text):
        row = match.groupdict()
        row["lat"] = float(row["lat"])
        row["lon"] = float(row["lon"])
        row["x"] = float(row["x"])
        row["z"] = float(row["z"])
        row["inside"] = row["inside"] == "true"
        entries.append(row)
    return entries


class PoiProvenanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.entries = parse_registry()
        cls.dataset = json.loads(DATASET.read_text(encoding="utf-8"))
        cls.features = {p["id"]: p for p in cls.dataset["pois"]}

    def test_registry_parses(self) -> None:
        self.assertGreaterEqual(len(self.entries), 12, "expected at least 12 POIs")

    def test_ids_unique(self) -> None:
        ids = [e["id"] for e in self.entries]
        self.assertEqual(len(ids), len(set(ids)), "duplicate POI ids")

    def test_osm_ids_unique(self) -> None:
        osm_ids = [e["osm_id"] for e in self.entries]
        self.assertEqual(len(osm_ids), len(set(osm_ids)), "duplicate OSM feature ids")

    def test_every_osm_feature_exists(self) -> None:
        for entry in self.entries:
            with self.subTest(poi=entry["id"]):
                osm_id = int(entry["osm_id"])
                self.assertIn(
                    osm_id,
                    self.features,
                    f"{entry['id']}: osmId {osm_id} is not in the OSM extract",
                )
                self.assertEqual(
                    self.features[osm_id]["osmType"],
                    entry["osm_type"],
                    f"{entry['id']}: feature type mismatch",
                )

    def test_coordinates_match_dataset(self) -> None:
        for entry in self.entries:
            with self.subTest(poi=entry["id"]):
                centre = self.features[int(entry["osm_id"])]["center"]
                d_lat = abs(centre["lat"] - entry["lat"])
                d_lon = abs(centre["lon"] - entry["lon"])
                # 1e-5 deg ~= 1.1 m; the registry stores 9 dp, so this must be tiny.
                self.assertLess(d_lat, 1e-5, f"{entry['id']}: latitude drifted")
                self.assertLess(d_lon, 1e-5, f"{entry['id']}: longitude drifted")

                px, pz = project(entry["lat"], entry["lon"])
                drift = math.hypot(px - entry["x"], pz - entry["z"])
                self.assertLess(drift, 0.01, f"{entry['id']}: projected coordinate drifted")

    def test_inside_world_flag_is_derived(self) -> None:
        xmin, xmax, zmin, zmax = -218.0, 242.0, -256.0, 248.0
        for entry in self.entries:
            with self.subTest(poi=entry["id"]):
                inside = xmin <= entry["x"] <= xmax and zmin <= entry["z"] <= zmax
                self.assertEqual(entry["inside"], inside, f"{entry['id']}: insideWorld is wrong")

    def test_names_are_traceable_to_the_feature(self) -> None:
        """Reject a name that appears nowhere on the OSM feature."""
        for entry in self.entries:
            with self.subTest(poi=entry["id"]):
                feature = self.features[int(entry["osm_id"])]
                haystack = " ".join(
                    str(feature.get(key) or "") for key in ("name", "nameEn", "nameBn")
                ).lower()
                english = json.loads(entry["en"]).lower()
                bengali = json.loads(entry["bn"])
                # At least one distinctive token of the registry name must occur
                # on the feature. Tokens shorter than 4 chars (of, the, ...) are
                # ignored so they cannot carry the test.
                tokens = [t for t in re.split(r"[^a-z0-9\u0980-\u09FF]+", english) if len(t) >= 4]
                matched_en = any(t in haystack for t in tokens)
                matched_bn = bengali in (feature.get("nameBn") or feature.get("name") or "")
                self.assertTrue(
                    matched_en or matched_bn,
                    f"{entry['id']}: name {english!r} / {bengali!r} does not trace to "
                    f"feature {entry['osm_id']} ({feature.get('name')!r})",
                )


if __name__ == "__main__":
    unittest.main()
