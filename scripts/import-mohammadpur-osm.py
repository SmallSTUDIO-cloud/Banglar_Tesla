#!/usr/bin/env python3
"""Import a source-attributed Mohammadpur road/POI database for the Unity game.

Network access is intentionally confined to this explicit importer, never game runtime.
Use --boundary-input/--overpass-input for reproducible offline imports and tests.
Only explicit OSM width tags are marked measured. Lane/class widths are estimates.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "unity/Assets/BanglarTesla/Data/Maps/mohammadpur.osm.json"
DEFAULT_REPORT = ROOT / "docs/GEOGRAPHIC_IMPORT_REPORT.md"
BOUNDARY_WAY_ID = 318722840
BOUNDARY_URL = f"https://www.openstreetmap.org/api/0.6/way/{BOUNDARY_WAY_ID}/full.json"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "BanglarTesla-Mohammadpur-Map-Import/1.0 (SmallSTUDIO-cloud/Banglar_Tesla)"
MAX_RESPONSE_BYTES = 96 * 1024 * 1024

DRIVING_CLASSES = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "road",
}
NON_DRIVING_CLASSES = {
    "footway", "cycleway", "path", "pedestrian", "steps", "track", "construction",
    "proposed", "bridleway", "corridor", "bus_guideway", "raceway",
}
# These are preview rendering fallbacks, never represented as surveyed road widths.
CLASS_WIDTH_ESTIMATE = {
    "motorway": 14.0, "trunk": 12.0, "primary": 10.0, "secondary": 8.0,
    "tertiary": 7.0, "unclassified": 5.0, "residential": 4.5,
    "living_street": 4.0, "service": 3.0, "road": 4.5,
    "footway": 1.8, "cycleway": 2.0, "pedestrian": 2.0, "path": 1.2,
    "steps": 1.5, "track": 2.5,
}
EXPECTED_LANDMARKS = (
    "Tajmahal Road", "Chandmia Housing", "Mohammadpur Town Hall Market",
    "Mohammadpur Agricultural Kacha Bazar", "Asad Avenue", "Salimullah Road",
    "Zakir Hossain Road", "Sher Shah Suri Road", "Shahjahan Road",
    "Nurjahan Road", "Ring Road", "Krishi Market",
)
TAG_ALLOWLIST = {
    "name", "name:bn", "name:en", "highway", "width", "lanes", "oneway", "surface",
    "access", "motor_vehicle", "motorcar", "area", "amenity", "shop", "building",
    "building:levels", "place", "tourism", "leisure", "office", "historic", "landuse",
    "railway", "public_transport", "bus", "barrier", "entrance", "addr:street",
    "addr:city", "addr:postcode", "addr:housenumber", "operator", "religion",
}


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("elements"), list):
        raise ValueError(f"Expected an OSM JSON object with elements: {path}")
    return value


def fetch_json(url: str, *, post_data: str | None = None, attempts: int = 3) -> tuple[dict[str, Any], bytes]:
    body = post_data.encode("utf-8") if post_data is not None else None
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=210) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise ValueError(f"Refusing oversized OSM response (> {MAX_RESPONSE_BYTES} bytes)")
            value = json.loads(payload)
            if not isinstance(value, dict) or not isinstance(value.get("elements"), list):
                raise ValueError("OSM endpoint did not return an elements array")
            return value, payload
        except Exception as error:  # retry network and malformed endpoint responses together
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"OSM download failed after {attempts} attempts: {last_error}")


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def normalize_name(value: str) -> str:
    # Preserve Bengali letters as well as Latin names; OSM may put either in `name`.
    return re.sub(r"[^a-z0-9\u0980-\u09ff]+", "", value.casefold())


def parse_length_m(value: Any) -> float | None:
    """Parse an explicit OSM length; return metres or None for ambiguous values."""
    if value is None:
        return None
    text = str(value).strip().lower().replace("−", "-")
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)\s*(m|meter|meters|metre|metres|cm|mm|ft|feet|')?", text)
    if not match:
        return None
    number = float(match.group(1))
    unit = match.group(2) or "m"
    if unit in ("cm",):
        number /= 100
    elif unit == "mm":
        number /= 1000
    elif unit in ("ft", "feet", "'"):
        number *= 0.3048
    return number if math.isfinite(number) and 0.2 <= number <= 100 else None


def parse_lanes(value: Any) -> int | None:
    """Return a whole lane count.

    OSM lanes are integers, but tags occasionally carry decimals or unit text.
    Serializing 2.0 instead of 2 breaks strict integer consumers, so the value is
    normalized here and invalid/silly values fail closed to None.
    """
    try:
        lanes = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(lanes) or not 0 < lanes <= 12:
        return None
    return int(round(lanes))


def finite_coordinate(node: dict[str, Any]) -> bool:
    return (
        isinstance(node.get("lat"), (int, float)) and isinstance(node.get("lon"), (int, float))
        and math.isfinite(node["lat"]) and math.isfinite(node["lon"])
        and -90 <= node["lat"] <= 90 and -180 <= node["lon"] <= 180
    )


def way_nodes(way: dict[str, Any]) -> list[int]:
    return [int(node) for node in way.get("nodes", []) if isinstance(node, int)]


def boundary_from_osm(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[int, dict[str, Any]]]:
    nodes = {int(e["id"]): e for e in raw["elements"] if e.get("type") == "node" and finite_coordinate(e)}
    ways = [e for e in raw["elements"] if e.get("type") == "way" and e.get("id") == BOUNDARY_WAY_ID]
    if len(ways) != 1:
        raise ValueError(f"Boundary way {BOUNDARY_WAY_ID} must occur exactly once")
    way = ways[0]
    refs = way_nodes(way)
    if len(refs) < 4 or refs[0] != refs[-1] or any(node not in nodes for node in refs):
        raise ValueError("Mohammadpur boundary is not a complete closed way")
    return way, nodes


def overpass_query(bounds: dict[str, float]) -> str:
    bbox = f"({bounds['south']:.7f},{bounds['west']:.7f},{bounds['north']:.7f},{bounds['east']:.7f})"
    return f"""[out:json][timeout:180];
(
  way[\"highway\"]{bbox};
  node[\"name\"]{bbox};
  way[\"name\"]{bbox};
);
out body;
>;
out skel qt;"""


def filtered_tags(tags: dict[str, Any]) -> dict[str, str]:
    return {key: str(value) for key, value in tags.items() if key in TAG_ALLOWLIST}


def width_data(tags: dict[str, Any]) -> tuple[float | None, float, float | None, str]:
    highway = str(tags.get("highway", ""))
    explicit = parse_length_m(tags.get("width"))
    lanes = parse_lanes(tags.get("lanes"))
    if explicit is not None:
        return explicit, explicit, lanes, "osm:width"
    if lanes is not None and highway not in NON_DRIVING_CLASSES:
        estimate = min(30.0, max(2.5, lanes * 3.0))
        return None, estimate, lanes, "estimated:lanes"
    estimate = CLASS_WIDTH_ESTIMATE.get(highway, 2.0)
    return None, estimate, lanes, "estimated:road-class"


def is_driveable(tags: dict[str, Any]) -> bool:
    highway = str(tags.get("highway", ""))
    if highway not in DRIVING_CLASSES or highway in NON_DRIVING_CLASSES:
        return False
    if str(tags.get("area", "no")).lower() == "yes":
        return False
    if str(tags.get("motor_vehicle", "")).lower() == "no" or str(tags.get("motorcar", "")).lower() == "no":
        return False
    return str(tags.get("access", "")).lower() not in {"no", "private"}


def centroid(points: list[dict[str, float]]) -> dict[str, float]:
    unique = points[:-1] if len(points) > 1 and points[0] == points[-1] else points
    if not unique:
        raise ValueError("Cannot compute an empty centroid")
    return {
        "lat": sum(point["lat"] for point in unique) / len(unique),
        "lon": sum(point["lon"] for point in unique) / len(unique),
    }


def point_inside(lon: float, lat: float, polygon: list[dict[str, float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i, a in enumerate(polygon):
        b = polygon[j]
        crosses = (a["lat"] > lat) != (b["lat"] > lat)
        if crosses:
            x = (b["lon"] - a["lon"]) * (lat - a["lat"]) / (b["lat"] - a["lat"]) + a["lon"]
            if lon < x:
                inside = not inside
        j = i
    return inside


def segment_intersection(a: dict[str, float], b: dict[str, float], c: dict[str, float], d: dict[str, float]) -> dict[str, float] | None:
    # Equirectangular distances are adequate for intersection within this small district.
    denominator = (b["lon"] - a["lon"]) * (d["lat"] - c["lat"]) - (b["lat"] - a["lat"]) * (d["lon"] - c["lon"])
    if abs(denominator) < 1e-18:
        return None
    t = ((c["lon"] - a["lon"]) * (d["lat"] - c["lat"]) - (c["lat"] - a["lat"]) * (d["lon"] - c["lon"])) / denominator
    u = ((c["lon"] - a["lon"]) * (b["lat"] - a["lat"]) - (c["lat"] - a["lat"]) * (b["lon"] - a["lon"])) / denominator
    if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9:
        return {"lat": a["lat"] + t * (b["lat"] - a["lat"]), "lon": a["lon"] + t * (b["lon"] - a["lon"])}
    return None


def boundary_crossings(road: dict[str, Any], polygon: list[dict[str, float]]) -> Iterable[dict[str, Any]]:
    points = road["geometry"]
    for index in range(len(points) - 1):
        a, b = points[index], points[index + 1]
        for edge in range(len(polygon) - 1):
            hit = segment_intersection(a, b, polygon[edge], polygon[edge + 1])
            if hit is not None:
                dx, dy = b["lon"] - a["lon"], b["lat"] - a["lat"]
                length = math.hypot(dx, dy) or 1.0
                yield {
                    "wayId": road["id"], "name": road["name"], "point": hit,
                    "tangent": {"lat": dy / length, "lon": dx / length},
                    "roadSegmentIndex": index, "boundarySegmentIndex": edge,
                }


def road_components(roads: list[dict[str, Any]]) -> list[int]:
    adjacency: dict[int, set[int]] = defaultdict(set)
    for road in roads:
        if not road["driveable"]:
            continue
        refs = road["nodeIds"]
        for a, b in zip(refs, refs[1:]):
            adjacency[a].add(b)
            adjacency[b].add(a)
    unseen = set(adjacency)
    sizes: list[int] = []
    while unseen:
        first = next(iter(unseen))
        stack = [first]
        unseen.remove(first)
        size = 0
        while stack:
            node = stack.pop()
            size += 1
            for neighbor in adjacency[node]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    stack.append(neighbor)
        sizes.append(size)
    return sorted(sizes, reverse=True)


def build_dataset(
    boundary_raw: dict[str, Any],
    overpass_raw: dict[str, Any],
    *,
    retrieved_at: str,
    boundary_sha256: str,
    overpass_sha256: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    boundary_way, boundary_nodes = boundary_from_osm(boundary_raw)
    boundary_refs = way_nodes(boundary_way)
    polygon = [{"lat": boundary_nodes[node]["lat"], "lon": boundary_nodes[node]["lon"]} for node in boundary_refs]
    lats = [point["lat"] for point in polygon]
    lons = [point["lon"] for point in polygon]
    padding = 0.0015
    bounds = {"south": min(lats) - padding, "north": max(lats) + padding, "west": min(lons) - padding, "east": max(lons) + padding}

    nodes = {int(e["id"]): e for e in overpass_raw["elements"] if e.get("type") == "node" and finite_coordinate(e)}
    ways = [e for e in overpass_raw["elements"] if e.get("type") == "way"]
    roads: list[dict[str, Any]] = []
    pois: list[dict[str, Any]] = []
    missing_geometry = 0
    for way in sorted(ways, key=lambda item: int(item["id"])):
        tags = filtered_tags(way.get("tags", {}))
        refs = way_nodes(way)
        geometry = [{"lat": nodes[node]["lat"], "lon": nodes[node]["lon"]} for node in refs if node in nodes]
        if len(geometry) < 2:
            missing_geometry += 1
            continue
        name = str(tags.get("name", ""))
        if "highway" in tags:
            explicit, width, lanes, width_source = width_data(tags)
            roads.append({
                "id": int(way["id"]), "nodeIds": refs, "geometry": geometry,
                "name": name, "nameBn": str(tags.get("name:bn", "")), "nameEn": str(tags.get("name:en", "")),
                "highway": str(tags["highway"]), "widthMeters": round(width, 3),
                "sourceWidthMeters": round(explicit, 3) if explicit is not None else None,
                "widthSource": width_source, "lanes": lanes, "oneWay": str(tags.get("oneway", "no")),
                "surface": str(tags.get("surface", "unknown")), "driveable": is_driveable(tags),
                "tags": tags,
            })
        elif name:
            pois.append({
                "id": int(way["id"]), "osmType": "way", "name": name,
                "nameBn": str(tags.get("name:bn", "")), "nameEn": str(tags.get("name:en", "")), "center": centroid(geometry),
                "nodeIds": refs, "geometry": geometry, "tags": tags,
            })
    for node in sorted(nodes.values(), key=lambda item: int(item["id"])):
        tags = filtered_tags(node.get("tags", {}))
        name = str(tags.get("name", ""))
        if name:
            pois.append({
                "id": int(node["id"]), "osmType": "node", "name": name,
                "nameBn": str(tags.get("name:bn", "")), "nameEn": str(tags.get("name:en", "")),
                "center": {"lat": node["lat"], "lon": node["lon"]},
                "nodeIds": [int(node["id"])], "geometry": [{"lat": node["lat"], "lon": node["lon"]}],
                "tags": tags,
            })

    exits: list[dict[str, Any]] = []
    for road in roads:
        if road["driveable"]:
            exits.extend(boundary_crossings(road, polygon))
    exits.sort(key=lambda item: (item["wayId"], item["roadSegmentIndex"], item["boundarySegmentIndex"]))

    named_features: list[dict[str, Any]] = []
    for road in roads:
        if road["name"]:
            named_features.append({"kind": "road", "id": road["id"], "name": road["name"], "nameBn": road["nameBn"], "nameEn": road["nameEn"]})
    for poi in pois:
        named_features.append({"kind": "poi", "id": poi["id"], "name": poi["name"], "nameBn": poi["nameBn"], "nameEn": poi["nameEn"]})
    landmark_matches: dict[str, list[dict[str, Any]]] = {}
    for expected in EXPECTED_LANDMARKS:
        aliases = [expected]
        if expected == "Chandmia Housing":
            aliases += ["Chand Miya Housing", "Chanmia Housing", "Chanmiya Housing", "চানমিয়া হাউজিং"]
        targets = [normalize_name(alias) for alias in aliases if normalize_name(alias)]
        matches = [
            feature for feature in named_features
            if any(target in normalize_name(feature[field]) for target in targets for field in ("name", "nameBn", "nameEn"))
        ]
        landmark_matches[expected] = matches

    dataset = {
        "schemaVersion": 1,
        "district": "Mohammadpur, Dhaka, Bangladesh",
        "status": "source-derived-preview; not a surveyed map",
        "source": {
            "provider": "OpenStreetMap contributors", "license": "ODbL-1.0",
            "copyright": "© OpenStreetMap contributors",
            "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
            "attributionUrl": "https://www.openstreetmap.org/copyright",
            "boundaryUrl": BOUNDARY_URL, "overpassUrl": OVERPASS_URL,
            "boundaryWayId": BOUNDARY_WAY_ID, "retrievedAt": retrieved_at,
            "boundarySha256": boundary_sha256, "overpassSha256": overpass_sha256,
            "query": overpass_query(bounds),
        },
        "bounds": bounds, "origin": centroid(polygon), "boundary": polygon,
        "roads": roads, "pois": pois, "boundaryExits": exits,
    }
    report = {
        "roadCount": len(roads), "driveableRoadCount": sum(road["driveable"] for road in roads),
        "namedRoadCount": sum(bool(road["name"]) for road in roads), "poiCount": len(pois),
        "explicitWidthCount": sum(road["widthSource"] == "osm:width" for road in roads),
        "laneEstimatedWidthCount": sum(road["widthSource"] == "estimated:lanes" for road in roads),
        "classEstimatedWidthCount": sum(road["widthSource"] == "estimated:road-class" for road in roads),
        "boundaryExitCount": len(exits), "driveableComponents": road_components(roads),
        "missingGeometryWays": missing_geometry, "landmarks": landmark_matches,
        "bounds": bounds, "origin": dataset["origin"], "retrievedAt": retrieved_at,
        "boundarySha256": boundary_sha256, "overpassSha256": overpass_sha256,
    }
    if not roads or len(polygon) < 4:
        raise ValueError("Import produced no usable roads or boundary")
    return dataset, report


def markdown_report(report: dict[str, Any], dataset: dict[str, Any]) -> str:
    lines = [
        "# Mohammadpur geographic import report", "",
        "**Status: source-derived Unity preview, not a surveyed or ground-truthed exact map.**", "",
        f"- Retrieved (UTC): `{report['retrievedAt']}`",
        f"- OSM boundary: way `{BOUNDARY_WAY_ID}`; ODbL 1.0, © OpenStreetMap contributors.",
        f"- Roads: **{report['roadCount']}** ({report['driveableRoadCount']} driveable; {report['namedRoadCount']} named).",
        f"- Named points/buildings: **{report['poiCount']}**.",
        f"- Explicit OSM width tags: **{report['explicitWidthCount']}**; lane-derived estimates: **{report['laneEstimatedWidthCount']}**; road-class estimates: **{report['classEstimatedWidthCount']}**.",
        f"- Detected driveable boundary crossings: **{report['boundaryExitCount']}**.",
        f"- Driveable graph component node counts: `{report['driveableComponents']}`.",
        f"- Named ways skipped for incomplete geometry: **{report['missingGeometryWays']}**.",
        f"- Origin: `{report['origin']}`; padded bbox: `{report['bounds']}`.",
        f"- Boundary payload SHA-256: `{report['boundarySha256']}`.",
        f"- Road/POI payload SHA-256: `{report['overpassSha256']}`.", "",
        "## Landmark lookup", "",
        "Presence here is a string match against the imported OSM data, not an independent accuracy certification.", "",
    ]
    for expected, matches in report["landmarks"].items():
        if matches:
            summary = ", ".join(f"{m['kind']} `{m['id']}` ({m['name']})" for m in matches[:8])
            lines.append(f"- **{expected}:** {summary}")
        else:
            lines.append(f"- **{expected}:** no matching imported name; requires separate verified sourcing, not guessed placement.")
    lines.extend([
        "", "## Accuracy limits", "",
        "OSM centerlines and tags are preserved with their element IDs. Absent widths use explicitly labeled rendering estimates. "
        "Road-class estimates are not exact road sizes. Named locations are not proof of building footprint, current business operation, architectural appearance or access permission. "
        "RAJUK's DAP map is a secondary reference to review; this import does not georeference it. Procedural buildings must remain labeled as visual infill.", "",
        "The continuous gameplay boundary and visible road-exit barricades are game constraints, not claims that real Mohammadpur is fenced.", "",
        "## Runtime data", "",
        f"- `{DEFAULT_OUTPUT.relative_to(ROOT).as_posix()}`",
        f"- Schema version: `{dataset['schemaVersion']}`; source retrieval metadata and query are embedded in the JSON.",
        "- Keep the accompanying ODbL notice and attribution in web, Android and credits.", "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--boundary-input", type=Path)
    parser.add_argument("--overpass-input", type=Path)
    parser.add_argument("--retrieved-at", help="ISO timestamp for reproducible offline fixtures")
    args = parser.parse_args()
    try:
        if args.boundary_input:
            boundary_raw = read_json(args.boundary_input)
            boundary_bytes = canonical_json(boundary_raw)
        else:
            boundary_raw, boundary_bytes = fetch_json(BOUNDARY_URL)
        # Compute the source-derived bbox before requesting roads.
        boundary_way, boundary_nodes = boundary_from_osm(boundary_raw)
        points = [boundary_nodes[node] for node in way_nodes(boundary_way)]
        bounds = {
            "south": min(node["lat"] for node in points) - 0.0015,
            "north": max(node["lat"] for node in points) + 0.0015,
            "west": min(node["lon"] for node in points) - 0.0015,
            "east": max(node["lon"] for node in points) + 0.0015,
        }
        if args.overpass_input:
            overpass_raw = read_json(args.overpass_input)
            overpass_bytes = canonical_json(overpass_raw)
        else:
            overpass_raw, overpass_bytes = fetch_json(OVERPASS_URL, post_data=overpass_query(bounds))
        retrieved_at = args.retrieved_at or dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
        dataset, report = build_dataset(
            boundary_raw, overpass_raw, retrieved_at=retrieved_at,
            boundary_sha256=sha256(boundary_bytes), overpass_sha256=sha256(overpass_bytes),
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        args.report.write_text(markdown_report(report, dataset), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        print(f"Mohammadpur import failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
