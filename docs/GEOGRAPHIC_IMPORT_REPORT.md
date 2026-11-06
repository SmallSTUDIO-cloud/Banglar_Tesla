# Mohammadpur geographic import report

**Status: source-derived Unity preview, not a surveyed or ground-truthed exact map.**

- Retrieved (UTC): `2026-11-06T10:27:35+00:00`
- OSM boundary: way `318722840`; ODbL 1.0, © OpenStreetMap contributors.
- Roads: **1610** (1490 driveable; 571 named).
- Named points/buildings: **2857**.
- Explicit OSM width tags: **3**; lane-derived estimates: **103**; road-class estimates: **1504**.
- Detected driveable boundary crossings: **129**.
- Driveable graph component node counts: `[5101, 103, 58, 4, 4, 3, 2, 2]`.
- Named ways skipped for incomplete geometry: **0**.
- Origin: `{'lat': 23.76292393643411, 'lon': 90.35741097364341}`; padded bbox: `{'south': 23.7501165, 'north': 23.7763701, 'west': 90.3439034, 'east': 90.37674899999999}`.
- Boundary payload SHA-256: `6aa04bad147ffa29145d70921061cd342a3726d077bc400056b110a3c8f52e3f`.
- Road/POI payload SHA-256: `1c5c9992c96174af2f8ef7793377d634c9ced9180b3eab264d94f41772557084`.

## Landmark lookup

Presence here is a string match against the imported OSM data, not an independent accuracy certification.

- **Tajmahal Road:** road `24692351` (Tajmahal Road), road `24692352` (Tajmahal Road), road `24706205` (Tajmahal Road), road `24706207` (Tajmahal Road), road `24706208` (Tajmahal Road), road `24706209` (Tajmahal Road), road `32766055` (Tajmahal Road), road `33085552` (Tajmahal Road)
- **Chandmia Housing:** poi `13990591896` (চানমিয়া হাউজিং)
- **Mohammadpur Town Hall Market:** poi `223068917` (Mohammadpur Town Hall Market), poi `12014830571` (Mohammadpur Town Hall Market)
- **Mohammadpur Agricultural Kacha Bazar:** poi `367368960` (Mohammadpur Agricultural Kacha Bazar)
- **Asad Avenue:** road `32561554` (Asad Avenue), road `223068915` (আসাদ এভিনিউ), road `337839595` (Asad Avenue), road `565418929` (আসাদ এভিনিউ), poi `629183947` (Asad Avenue Masjid)
- **Salimullah Road:** road `33085032` (সলিমুল্লাহ রোড), road `33087861` (Salimullah Road), road `33087887` (Salimullah Road), road `33087932` (Salimullah Road), road `33087977` (Salimullah Road), road `33170527` (Salimullah Road), road `375512955` (Salimullah Road), road `375513248` (Salimullah Road)
- **Zakir Hossain Road:** road `33170451` (Zakir Hossain Road), road `33798055` (Zakir Hossain Road), road `33798130` (Zakir Hossain Road), road `33798140` (Zakir Hossain Road), road `33798152` (Zakir Hossain Road), road `33798162` (Zakir Hossain Road), road `33798163` (Zakir Hossain Road), road `33798165` (Zakir Hossain Road)
- **Sher Shah Suri Road:** road `33088022` (Sher Shah Suri Road), road `33088032` (Sher Shah Suri Road), road `223099128` (Sher Shah Suri Road), road `438041572` (Sher Shah Suri Road), road `490294321` (Sher Shah Suri Road), road `490294323` (Sher Shah Suri Road), road `500359530` (Sher Shah Suri Road), road `500359531` (Sher Shah Suri Road)
- **Shahjahan Road:** road `33832997` (শাহজাহান রোড), road `1357827144` (শাহজাহান রোড)
- **Nurjahan Road:** road `33087547` (Nurjahan Road), road `33087570` (Nurjahan Road), road `409575563` (নুরজাহান রোড), road `441115749` (Nurjahan Road)
- **Ring Road:** road `33832973` (রিং রোড), road `223063066` (রিং রোড), road `566654336` (রিং রোড), road `1103814249` (রিং রোড), poi `1378265235` (Probal Housing,Ring Road)
- **Krishi Market:** no matching imported name; requires separate verified sourcing, not guessed placement.

## Accuracy limits

OSM centerlines and tags are preserved with their element IDs. Absent widths use explicitly labeled rendering estimates. Road-class estimates are not exact road sizes. Named locations are not proof of building footprint, current business operation, architectural appearance or access permission. RAJUK's DAP map is a secondary reference to review; this import does not georeference it. Procedural buildings must remain labeled as visual infill.

The continuous gameplay boundary and visible road-exit barricades are game constraints, not claims that real Mohammadpur is fenced.

## Runtime data

- `unity/Assets/BanglarTesla/Data/Maps/mohammadpur.osm.json`
- Schema version: `1`; source retrieval metadata and query are embedded in the JSON.
- Keep the accompanying ODbL notice and attribution in web, Android and credits.
