"""Offline contracts for the source-derived Mohammadpur minimap renderer."""
from __future__ import annotations

import importlib.util
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/render-mohammadpur-minimap.py"
SPEC = importlib.util.spec_from_file_location("mohammadpur_minimap", SCRIPT)
assert SPEC and SPEC.loader
minimap = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = minimap
SPEC.loader.exec_module(minimap)


class MinimapContracts(unittest.TestCase):
    def test_png_is_deterministic_and_has_requested_dimensions(self):
        dataset = {
            "origin": {"lat": 23.75, "lon": 90.35},
            "bounds": {"south": 23.74, "north": 23.76, "west": 90.34, "east": 90.36},
            "boundary": [
                {"lat": 23.74, "lon": 90.34}, {"lat": 23.76, "lon": 90.34},
                {"lat": 23.76, "lon": 90.36}, {"lat": 23.74, "lon": 90.36},
                {"lat": 23.74, "lon": 90.34},
            ],
            "roads": [{
                "highway": "residential", "driveable": True,
                "geometry": [{"lat": 23.75, "lon": 90.34}, {"lat": 23.75, "lon": 90.36}],
            }],
            "pois": [], "boundaryExits": [],
        }
        first = minimap.render_minimap(dataset, 256)
        second = minimap.render_minimap(dataset, 256)
        self.assertEqual(first, second)
        self.assertTrue(first.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(struct.unpack(">II", first[16:24]), (256, 256))
        self.assertGreater(len(first), 500)


if __name__ == "__main__":
    unittest.main()
