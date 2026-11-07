# Mohammadpur map data — OpenStreetMap / ODbL notice

The geographic database in `mohammadpur.osm.json` is derived from **© OpenStreetMap contributors** and is made available under the **Open Database License 1.0 (ODbL)**.

- Copyright and attribution: https://www.openstreetmap.org/copyright
- License: https://opendatacommons.org/licenses/odbl/1-0/
- Boundary source: OpenStreetMap way `318722840` (`Mohammadpur Thana`).
- Exact source URLs, retrieval timestamp, query and payload checksums are embedded in the JSON file.

The importer preserves OSM element IDs, road centerlines and available tags. Where no explicit `width` tag exists, the JSON marks the value as a lane-derived or road-class **estimate**. These estimates are gameplay rendering choices, not surveyed measurements. Procedural buildings and scenery are original game artwork and must not be represented as source-verified real-world architecture.

The schematic texture at `unity/Assets/BanglarTesla/Resources/UI/mohammadpur-minimap.png` is a produced work rendered from the same database. Its road thickness is a legibility choice, not surveyed width; red exit markers are gameplay constraints. Retain © OpenStreetMap contributors attribution wherever this minimap is used.

Keep this notice accessible in the game's credits and in distributed web/Android map data. If the derived database is publicly used, ODbL attribution and share-alike obligations continue to apply. This file does not relicense unrelated game code, original artwork, fonts, audio or user-supplied posters.

## Location and provenance

This notice and `mohammadpur.osm.json` sit outside the game's `src/` tree
deliberately. They were relocated here on 2026-11-07 from
`unity/Assets/BanglarTesla/Data/Maps/` when the Unity/C# migration was retired, so
that the shared source data survived the closure of that experiment. Git recorded
the move as a 100% rename, so file history is continuous.

`scripts/import-mohammadpur-osm.py` writes `mohammadpur.osm.json`, and
`.github/workflows/import-mohammadpur-map.yml` re-runs it and commits the result
whenever the importer, the minimap renderer or the workflow itself changes. Each
run refreshes `retrievedAt` and the upstream payload checksums inside the JSON, so
the file's own SHA-256 changes even when the road and POI content does not. Check
the embedded `source` block for the authoritative retrieval metadata rather than
relying on a hash recorded elsewhere.

The importer may also regenerate `docs/GEOGRAPHIC_IMPORT_REPORT.md`, which is why
this notice exists in a hand-maintained file: anything recorded there would be
overwritten on the next import.
