"""Provenance gate for the v0.7.0 landmark registry (src/world/landmarks.ts).

The TypeScript unit tests prove the *math* (a landmark's game coordinate is the
computed projection of its stored lat/lon). They cannot prove the *source*,
because this project ships no Node typings and the production build type-checks
test files.

This module closes that gap: it parses the landmark registry out of the
TypeScript source and verifies every record against
`data/mohammadpur/mohammadpur.osm.json`. A landmark whose OSM id does not exist,
or whose lat/lon/name was invented or adjusted, fails here.
"""
from __future__ import annotations

import json
import math
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "src" / "world" / "landmarks.ts"
DATASET = ROOT / "data" / "mohammadpur" / "mohammadpur.osm.json"

# Projection constants, kept in sync with src/world/landmarks.ts.
LAT0, LON0, SCALE = 23.7624, 90.3646, 0.36
METRES_PER_DEG_LAT = 111132
METRES_PER_DEG_LON = 111320 * math.cos(math.radians(LAT0))


def project(lat: float, lon: float) -> tuple[float, float]:
    x = (lon - LON0) * METRES_PER_DEG_LON * SCALE
    z = (LAT0 - lat) * METRES_PER_DEG_LAT * SCALE
    return x, z


def parse_registry() -> list[dict]:
    """Extract each landmark object literal from the TypeScript registry."""
    text = REGISTRY.read_text(encoding="utf-8")
    # Each record starts at "    id: '<id>'," inside the LANDMARKS array and ends
    # at the closing brace that precedes the next record or the array terminator.
    starts = [m.start() for m in re.finditer(r"\n  \{\n    id: '", text)]
    records = []
    for i, start in enumerate(starts):
        end = text.index("\n  },", start) + len("\n  },")
        block = text[start:end]
        rec: dict = {}
        rec["id"] = re.search(r"id: '([a-z_]+)'", block).group(1)
        # Name literals may use single or double quotes (e.g. Queen's College
        # contains an apostrophe and is written double-quoted).
        def quoted(field: str) -> str:
            m = re.search(rf"{field}: (['\"])(.*?)\1,", block)
            if not m:
                raise AssertionError(f"could not parse {field} in record {rec.get('id')}")
            return m.group(2)

        rec["nameEn"] = quoted("nameEn")
        rec["nameBn"] = quoted("nameBn")
        rec["x"] = float(re.search(r"\n    x: (-?[\d.]+),", block).group(1))
        rec["z"] = float(re.search(r"\n    z: (-?[\d.]+),", block).group(1))
        src = re.search(
            r"source: \{ osmId: (\d+), osmType: '(\w+)', lat: (-?[\d.]+), lon: (-?[\d.]+) \}",
            block,
        )
        rec["osmId"] = int(src.group(1))
        rec["osmType"] = src.group(2)
        rec["lat"] = float(src.group(3))
        rec["lon"] = float(src.group(4))
        records.append(rec)
    return records


class LandmarkProvenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = parse_registry()
        data = json.loads(DATASET.read_text(encoding="utf-8"))
        cls.pois = {p["id"]: p for p in data["pois"]}

    def test_registry_parsed(self):
        self.assertGreaterEqual(len(self.records), 3, "landmark registry looks empty")
        ids = [r["id"] for r in self.records]
        self.assertEqual(len(ids), len(set(ids)), f"duplicate landmark ids: {ids}")

    def test_every_osm_feature_exists(self):
        for rec in self.records:
            self.assertIn(
                rec["osmId"], self.pois, f"{rec['id']}: OSM id {rec['osmId']} not in dataset"
            )

    def test_osm_type_matches(self):
        for rec in self.records:
            self.assertEqual(
                self.pois[rec["osmId"]]["osmType"],
                rec["osmType"],
                f"{rec['id']}: osmType mismatch",
            )

    def test_coordinates_match_dataset(self):
        # 1e-6 deg is ~11 cm; enough to absorb centroid rounding, far too tight
        # to hide a relocated or invented landmark.
        for rec in self.records:
            center = self.pois[rec["osmId"]]["center"]
            self.assertAlmostEqual(
                center["lat"], rec["lat"], delta=1e-6, msg=f"{rec['id']}: lat drifted"
            )
            self.assertAlmostEqual(
                center["lon"], rec["lon"], delta=1e-6, msg=f"{rec['id']}: lon drifted"
            )

    def test_game_coordinates_are_the_projection(self):
        for rec in self.records:
            px, pz = project(rec["lat"], rec["lon"])
            self.assertAlmostEqual(rec["x"], px, delta=0.005, msg=f"{rec['id']}: x fabricated")
            self.assertAlmostEqual(rec["z"], pz, delta=0.005, msg=f"{rec['id']}: z fabricated")

    def test_names_are_bengali_and_present(self):
        bengali = re.compile(r"[\u0980-\u09FF]")
        for rec in self.records:
            self.assertTrue(bengali.search(rec["nameBn"]), f"{rec['id']}: nameBn not Bengali")
            self.assertTrue(rec["nameEn"].strip(), f"{rec['id']}: empty nameEn")

    def test_market_names_appear_in_source_naming(self):
        # Spot-check that the registry name is genuinely what OSM calls the
        # feature, rather than a plausible-looking invention.
        town_hall = next(r for r in self.records if r["id"] == "town_hall_bazar")
        poi = self.pois[town_hall["osmId"]]
        self.assertEqual(poi.get("name"), "Mohammadpur Town Hall Market")

        # Note the asymmetry, which is a real property of the source data:
        # Town Hall is tagged amenity=marketplace, while the Krishi blocks are
        # tagged building=commercial and only carry the market identity in
        # their name. The registry must not pretend otherwise.
        krishi = next(r for r in self.records if r["id"] == "krishi_market")
        poi = self.pois[krishi["osmId"]]
        self.assertIn("কৃষি", poi.get("name", ""))
        self.assertIn("পাইকারী বাজার", poi.get("name", ""))
        self.assertEqual(poi.get("tags", {}).get("building"), "commercial")
        self.assertIsNone(poi.get("tags", {}).get("amenity"))

    def test_town_hall_anchor_lies_inside_its_own_osm_polygon(self):
        """The market point must fall inside the marketplace polygon OSM has for it.

        Added while writing docs/PRIORITY_A_TOWN_HALL_SPEC.md: the audit relies on
        'the anchor is correct, only the form is missing'. That claim is only true
        if the anchor is physically inside the mapped market area. This pins it, so
        a future re-anchor to a plausible-looking but wrong point fails here.
        """
        town_hall = next(r for r in self.records if r["id"] == "town_hall_bazar")
        poi = self.pois[town_hall["osmId"]]
        ring = [(pt["lat"], pt["lon"]) for pt in poi["geometry"]]
        self.assertGreaterEqual(len(ring), 4, "market polygon is not a usable ring")
        self.assertEqual(ring[0], ring[-1], "market polygon ring is not closed")

        # Point-in-polygon in local metres so the test does not depend on how the
        # game projects; longitude is scaled by cos(lat) to keep the shape honest.
        import math

        cos = math.cos(math.radians(LAT0))
        poly = [((lon - LON0) * cos, (lat - LAT0)) for lat, lon in ring]
        px = (town_hall["lon"] - LON0) * cos
        pz = town_hall["lat"] - LAT0

        inside = False
        j = len(poly) - 1
        for i in range(len(poly)):
            xi, yi = poly[i]
            xj, yj = poly[j]
            if (yi > pz) != (yj > pz) and px < (xj - xi) * (pz - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        self.assertTrue(inside, "town_hall_bazar is outside its own OSM marketplace polygon")

    def test_places_anchored_to_landmarks(self):
        """layout.ts must anchor the named markets to the registry, not rote fractions."""
        layout = (ROOT / "src" / "world" / "layout.ts").read_text(encoding="utf-8")
        self.assertIn("makePlaceAtLandmark('bazaar', 'place.bazaar', 'town_hall_bazar'", layout)
        self.assertIn("makePlaceAtLandmark('market', 'place.market', 'krishi_market'", layout)
        # The old, geographically wrong anchors must be gone.
        self.assertNotIn("makePlaceOnSegment('bazaar', 'place.bazaar', 'asad_3'", layout)
        self.assertNotIn("makePlaceOnSegment('market', 'place.market', 'ring_3'", layout)


if __name__ == "__main__":
    unittest.main()
