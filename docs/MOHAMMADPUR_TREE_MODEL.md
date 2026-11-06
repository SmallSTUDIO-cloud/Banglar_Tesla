# Mohammadpur street-tree model — 31 October 2026

Replaced the old roadside **cylinder plus two cone** silhouette with a tapered trunk, visible branching and an irregular, layered broadleaf crown. Rounded opaque low-poly foliage, muted green/seasonal-flowering variations and slight shape/height differences match the existing stylized streetscape. The original curbside candidate positions and seeded-city random draw sequence are retained. Tree trunks are filtered against newly occupied building footprints **after** block infill; the established road-clearance check still runs before adding candidates. Trees remain non-collidable, as before. Tree geometry joins the existing cullable sector detail meshes, using the existing Lambert/vertex-color material: no new tree draw calls, textures, per-tree mesh objects, transparent foliage overdraw or dynamic lights.

## Actual browser evidence

Controlled **same road-facing camera, daytime, 960×540 Chromium/SwiftShader**: [`before`](../artifacts/mohammadpur-tree/before.png) and [`after`](../artifacts/mohammadpur-tree/after.png). The `before` image was captured immediately before this *tree-only* change, on top of the previous world/window-light work; it is **not** the deleted pre-visual-pass browser baseline referenced in `REAL_DEVICE_MOHAMMADPUR_VISUAL_GAP_CLOSURE_REPORT.md`. Raw scene metadata: `artifacts/mohammadpur-tree/{before,after}-metrics.json`. The street-facing old model is clearly the triangular cone at center-left; the revised image shows a broader, branched, rounded canopy on the same site.

| Browser scene | Before | After |
| --- | ---: | ---: |
| Render calls | 86 | 86 |
| Submitted triangles | 426,215 | 449,399 (+23,184; +5.44%) |
| Reported GPU geometries | 292 | 292 |
| Textures | 18 | 18 |
| Browser/GL errors | 0 | 0 |

**Not a measured device FPS improvement.** Software-browser submission times fluctuate and are not used as speed claims. `node tests/e2e/mohammadpur-tree-audit.mjs` found **108 accepted street trees**, zero trunk/building OBB overlaps in the generated city, zero separately drawn tree objects and zero GL errors. The model unit test bounds per-tree topology (<450 triangles), single indexed batch, 3D bounds and deterministic seed. `npm run build`, `npm test` (38 files, 226 tests), `npm run test:e2e` (21/21) and `npm run test:mobile` (13/13 mobile-browser checks, **not** Android hardware) passed after implementation. Sustained real-device performance/thermal and actual tree-canopy/building intersections were **not** validated in this tree-specific pass. Crown tips may visually overlap building awnings in some locations; the clearance guarantee concerns trunks/footpaths and driving lanes, not every airborne branch.
