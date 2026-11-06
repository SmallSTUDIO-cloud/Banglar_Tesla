"""Offline contract tests for the source-attributed Mohammadpur importer."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/import-mohammadpur-osm.py"
SPEC = importlib.util.spec_from_file_location("mohammadpur_import", SCRIPT)
assert SPEC and SPEC.loader
osm = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = osm
SPEC.loader.exec_module(osm)


def boundary_fixture():
    nodes = [
        {"type": "node", "id": 1, "lat": 23.75, "lon": 90.35},
        {"type": "node", "id": 2, "lat": 23.75, "lon": 90.36},
        {"type": "node", "id": 3, "lat": 23.76, "lon": 90.36},
        {"type": "node", "id": 4, "lat": 23.76, "lon": 90.35},
    ]
    way = {"type": "way", "id": osm.BOUNDARY_WAY_ID, "nodes": [1, 2, 3, 4, 1], "tags": {"place": "suburb"}}
    return {"version": "0.6", "elements": nodes + [way]}


def overpass_fixture():
    nodes = [
        {"type": "node", "id": 11, "lat": 23.755, "lon": 90.355},
        {"type": "node", "id": 12, "lat": 23.755, "lon": 90.361},
        {"type": "node", "id": 13, "lat": 23.757, "lon": 90.355},
        {"type": "node", "id": 14, "lat": 23.752, "lon": 90.354},
        {"type": "node", "id": 15, "lat": 23.753, "lon": 90.354},
        {"type": "node", "id": 20, "lat": 23.756, "lon": 90.356, "tags": {"name": "চানমিয়া হাউজিং", "name:en": "Chanmia Housing", "place": "neighbourhood"}},
        {"type": "node", "id": 21, "lat": 23.758, "lon": 90.357},
        {"type": "node", "id": 22, "lat": 23.7585, "lon": 90.357},
        {"type": "node", "id": 23, "lat": 23.7585, "lon": 90.3575},
        {"type": "node", "id": 24, "lat": 23.758, "lon": 90.3575},
    ]
    ways = [
        {"type": "way", "id": 201, "nodes": [11, 12], "tags": {"name": "Tajmahal Road", "highway": "residential", "width": "6 m", "surface": "asphalt"}},
        {"type": "way", "id": 202, "nodes": [13, 11], "tags": {"name": "Asad Avenue", "name:bn": "আসাদ এভিনিউ", "highway": "tertiary", "lanes": "2"}},
        {"type": "way", "id": 203, "nodes": [14, 15], "tags": {"highway": "footway"}},
        {"type": "way", "id": 301, "nodes": [21, 22, 23, 24, 21], "tags": {"name": "Mohammadpur Town Hall Market", "amenity": "marketplace", "building": "yes"}},
    ]
    return {"version": "0.6", "elements": nodes + ways}


class ImportContracts(unittest.TestCase):
    def build(self):
        return osm.build_dataset(
            boundary_fixture(), overpass_fixture(), retrieved_at="2026-11-06T00:00:00+00:00",
            boundary_sha256="a" * 64, overpass_sha256="b" * 64,
        )

    def test_explicit_units_are_metres_and_ambiguity_fails_closed(self):
        self.assertEqual(osm.parse_length_m("350 cm"), 3.5)
        self.assertEqual(osm.parse_length_m("10 ft"), 3.048)
        self.assertEqual(osm.parse_length_m("6"), 6)
        self.assertIsNone(osm.parse_length_m("narrow"))
        self.assertIsNone(osm.parse_length_m("6..8"))
        self.assertIsNone(osm.parse_length_m("-4"))

    def test_roads_preserve_provenance_widths_names_and_shared_junctions(self):
        dataset, report = self.build()
        roads = {road["id"]: road for road in dataset["roads"]}
        self.assertEqual(roads[201]["widthSource"], "osm:width")
        self.assertEqual(roads[201]["sourceWidthMeters"], 6)
        self.assertEqual(roads[202]["widthSource"], "estimated:lanes")
        self.assertIsNone(roads[202]["sourceWidthMeters"])
        self.assertEqual(roads[202]["lanes"], 2)
        self.assertIs(type(roads[202]["lanes"]), int)
        self.assertEqual(roads[202]["nameBn"], "আসাদ এভিনিউ")
        self.assertFalse(roads[203]["driveable"])
        self.assertEqual(report["driveableComponents"], [3])
        self.assertEqual(dataset["source"]["license"], "ODbL-1.0")
        self.assertIn("© OpenStreetMap contributors", dataset["source"]["copyright"])

    def test_boundary_exit_and_landmarks_are_source_derived(self):
        dataset, report = self.build()
        self.assertEqual(report["boundaryExitCount"], 1)
        exit = dataset["boundaryExits"][0]
        self.assertEqual(exit["wayId"], 201)
        self.assertAlmostEqual(exit["point"]["lon"], 90.36)
        self.assertAlmostEqual(exit["point"]["lat"], 23.755)
        self.assertEqual(report["landmarks"]["Tajmahal Road"][0]["id"], 201)
        self.assertEqual(report["landmarks"]["Chandmia Housing"][0]["id"], 20)
        self.assertEqual(report["landmarks"]["Chandmia Housing"][0]["nameEn"], "Chanmia Housing")
        self.assertEqual(report["landmarks"]["Mohammadpur Town Hall Market"][0]["id"], 301)
        self.assertIn("not a surveyed", osm.markdown_report(report, dataset))

    def test_offline_cli_writes_repeatable_data_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            boundary = base / "boundary.json"
            overpass = base / "overpass.json"
            output = base / "map.json"
            report = base / "report.md"
            boundary.write_text(json.dumps(boundary_fixture()), encoding="utf-8")
            overpass.write_text(json.dumps(overpass_fixture()), encoding="utf-8")
            subprocess.run([
                sys.executable, str(SCRIPT), "--boundary-input", str(boundary),
                "--overpass-input", str(overpass), "--retrieved-at", "2026-11-06T00:00:00+00:00",
                "--output", str(output), "--report", str(report),
            ], check=True, capture_output=True, text=True)
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["source"]["retrievedAt"], "2026-11-06T00:00:00+00:00")
            self.assertEqual(len(data["roads"]), 3)
            self.assertIn("requires separate verified sourcing", report.read_text(encoding="utf-8"))

    def test_incomplete_boundary_is_rejected(self):
        raw = boundary_fixture()
        raw["elements"][-1]["nodes"] = [1, 2, 3]
        with self.assertRaisesRegex(ValueError, "closed way"):
            osm.boundary_from_osm(raw)


if __name__ == "__main__":
    unittest.main()
