"""Provenance gate for the Mohammadpur road graph (src/world/mohammadpurData.ts).

The TypeScript unit tests cover lane topology, routing and geometry maths. They
cannot check the *source* of a road, because this project ships no Node typings
and the production build type-checks test files (same reason as
`test_landmark_provenance.py`).

Nothing previously verified road provenance at all. A segment could cite an
`osmWayId` that does not exist in the imported extract -- a typo, a stale id
from a regenerated extract, or an invented number -- and every existing test
would stay green. This module closes that gap: it parses the raw node/edge
tables out of the TypeScript source and cross-checks them against
`data/mohammadpur/mohammadpur.osm.json`.

Deliberately NOT asserted here:

- road *geometry* against OSM. The graph is a hand-placed straight-chord
  approximation anchored at exact landmarks; the source header says so
  explicitly ("the osmWayId records which way the corridor came from. Road
  geometry is not [real]"). Asserting alignment would be a P3 requirement, and
  measured deviation is recorded in docs/MOHAMMADPUR_GEOGRAPHIC_AUDIT.md
  instead.
- exact segment/node/lane counts. Those are baselines (845 / 140 / `c52306cb0`),
  owned by `baseline:*` tooling, and hard-coding them here would block
  legitimate map growth.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src" / "world" / "mohammadpurData.ts"
DATASET = ROOT / "data" / "mohammadpur" / "mohammadpur.osm.json"

EDGE_RE = re.compile(r"^\s*\{ id: '(?P<id>[a-z0-9_]+)', from: '(?P<from>[a-z0-9_]+)', to: '(?P<to>[a-z0-9_]+)',")
NODE_RE = re.compile(r"^\s*\{ id: '(?P<id>[a-z0-9_]+)', x: (?P<x>-?[\d.]+), z: (?P<z>-?[\d.]+)")


def _section(text: str, start_marker: str, end_marker: str) -> str:
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[start:end]


def parse_nodes() -> list[dict]:
    text = SOURCE.read_text(encoding="utf-8")
    body = _section(text, "export const MOHAMMADPUR_NODES", "export const MOHAMMADPUR_EDGES")
    nodes = []
    for line in body.splitlines():
        m = NODE_RE.match(line)
        if m:
            nodes.append({"id": m.group("id"), "x": float(m.group("x")), "z": float(m.group("z"))})
    return nodes


def parse_edges() -> list[dict]:
    text = SOURCE.read_text(encoding="utf-8")
    body = _section(text, "export const MOHAMMADPUR_EDGES", "\nexport ")
    edges = []
    for line in body.splitlines():
        m = EDGE_RE.match(line)
        if not m:
            continue
        rec = {"id": m.group("id"), "from": m.group("from"), "to": m.group("to")}
        src = re.search(r"source: '(\w+)'", line)
        way = re.search(r"osmWayId: (\d+)", line)
        name = re.search(r"nameEn: '([^']*)'", line)
        kind = re.search(r"kind: '(\w+)'", line)
        rec["source"] = src.group(1) if src else None
        rec["osmWayId"] = int(way.group(1)) if way else None
        rec["nameEn"] = name.group(1) if name else None
        rec["kind"] = kind.group(1) if kind else None
        edges.append(rec)
    return edges


class RoadProvenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nodes = parse_nodes()
        cls.edges = parse_edges()
        data = json.loads(DATASET.read_text(encoding="utf-8"))
        cls.ways = {w["id"]: w for w in data["roads"]}
        cls.node_ids = {n["id"] for n in cls.nodes}

    # --- parsing sanity -------------------------------------------------
    def test_tables_parsed(self):
        self.assertGreater(len(self.nodes), 0, "no nodes parsed out of the source")
        self.assertGreater(len(self.edges), 0, "no edges parsed out of the source")

    def test_every_edge_parsed_its_source_and_kind(self):
        for e in self.edges:
            self.assertIn(e["source"], ("osm", "approx_lane"), f"{e['id']} has no parseable source")
            self.assertIn(e["kind"], ("main", "medium", "gali"), f"{e['id']} has no parseable kind")
            self.assertIsNotNone(e["nameEn"], f"{e['id']} has no parseable nameEn")

    # --- the actual provenance gate -------------------------------------
    def test_every_osm_edge_cites_a_way_id(self):
        """source: 'osm' is a provenance claim; it must name the way."""
        for e in self.edges:
            if e["source"] == "osm":
                self.assertIsNotNone(e["osmWayId"], f"edge {e['id']} claims source 'osm' but cites no osmWayId")

    def test_every_cited_way_exists_in_the_dataset(self):
        """The gap this module was written for: dangling/typo'd way ids."""
        missing = [
            (e["id"], e["osmWayId"])
            for e in self.edges
            if e["osmWayId"] is not None and e["osmWayId"] not in self.ways
        ]
        self.assertEqual(missing, [], f"edges cite osmWayIds absent from the extract: {missing}")

    def test_no_approx_lane_edge_pretends_to_cite_a_way(self):
        """`approx_lane` means procedural connector; citing a way contradicts it."""
        for e in self.edges:
            if e["source"] == "approx_lane":
                self.assertIsNone(e["osmWayId"], f"procedural edge {e['id']} carries an osmWayId")

    def test_every_cited_way_is_driveable(self):
        """A drivable game street must not be sourced from a footway or path."""
        for e in self.edges:
            if e["osmWayId"] is None:
                continue
            way = self.ways[e["osmWayId"]]
            self.assertTrue(
                way.get("driveable"),
                f"edge {e['id']} cites way {e['osmWayId']} ({way.get('highway')}), which is not driveable",
            )

    def test_cited_way_has_usable_geometry(self):
        for e in self.edges:
            if e["osmWayId"] is None:
                continue
            geom = self.ways[e["osmWayId"]].get("geometry") or []
            self.assertGreaterEqual(len(geom), 2, f"edge {e['id']} cites way {e['osmWayId']} with <2 points")
            for pt in geom:
                self.assertIn("lat", pt)
                self.assertIn("lon", pt)

    # --- graph integrity -------------------------------------------------
    def test_every_edge_endpoint_is_a_known_node(self):
        for e in self.edges:
            self.assertIn(e["from"], self.node_ids, f"edge {e['id']} from-node {e['from']} does not exist")
            self.assertIn(e["to"], self.node_ids, f"edge {e['id']} to-node {e['to']} does not exist")

    def test_no_self_loops(self):
        for e in self.edges:
            self.assertNotEqual(e["from"], e["to"], f"edge {e['id']} loops onto itself")

    def test_edge_and_node_ids_are_unique(self):
        self.assertEqual(len(self.node_ids), len(self.nodes), "duplicate node id")
        edge_ids = [e["id"] for e in self.edges]
        self.assertEqual(len(set(edge_ids)), len(edge_ids), "duplicate edge id")

    def test_nodes_have_finite_integer_coordinates(self):
        for n in self.nodes:
            self.assertTrue(n["x"] == int(n["x"]), f"node {n['id']} x is not integral: {n['x']}")
            self.assertTrue(n["z"] == int(n["z"]), f"node {n['id']} z is not integral: {n['z']}")

    def test_bbox_is_consistent_with_the_dataset(self):
        """Every node must fall inside the imported extract's own bbox -- a node
        outside it is either a typo or a world expansion that skipped the data."""
        data = json.loads(DATASET.read_text(encoding="utf-8"))
        bounds = data["bounds"]
        lat0, lon0, scale = 23.7624, 90.3646, 0.36
        m_per_deg_lat = 111132
        import math

        m_per_deg_lon = 111320 * math.cos(math.radians(lat0))
        for n in self.nodes:
            lon = lon0 + (n["x"] / scale) / m_per_deg_lon
            lat = lat0 - (n["z"] / scale) / m_per_deg_lat
            self.assertGreaterEqual(lat, bounds["south"], f"node {n['id']} lat {lat:.6f} south of extract")
            self.assertLessEqual(lat, bounds["north"], f"node {n['id']} lat {lat:.6f} north of extract")
            self.assertGreaterEqual(lon, bounds["west"], f"node {n['id']} lon {lon:.6f} west of extract")
            self.assertLessEqual(lon, bounds["east"], f"node {n['id']} lon {lon:.6f} east of extract")


if __name__ == "__main__":
    unittest.main()
