# Production recovery plan — returning to the Three.js baseline

Status: **plan only. Nothing destructive has been executed.**
Branch: `arena/f78d620e-banglar-tesla`
Baseline verified: 2026-11-07 against GitHub (not local history).

---

## 1. Verified production baseline

Everything below was read from the GitHub API, not assumed from the local clone.
The local `.git` in this environment resets to the branch base between commands,
so all git state in this document was re-fetched and re-verified.

| Fact | Verified value |
| --- | --- |
| Latest release | `v0.6.7` — "Banglar Tesla v0.6.7 — debug test APK (latest features)" |
| Release published | 2026-11-05T16:32:27Z |
| Release flags | `draft=false`, **`prerelease=true`** |
| Tag `v0.6.7` → commit | `8379f259db778e484185641b6f92620fd662fc58` |
| Release `target_commitish` | `8379f259…` (matches the tag — consistent) |
| `main` tip | `619a7743ecca092ef671d1df17b401eaa791d69b` |
| `v0.6.7` vs `main` | `ahead_by: 1`, `behind_by: 0` — main is v0.6.7 plus one merge commit, no divergence |
| APK asset | `banglar-tesla-v0.6.7-debug.apk`, 13,546,101 bytes, download count 2 |
| APK SHA-256 | `e0b4901f127205ca6d2d79fff8761257e6bd306163c791d7ce8ef275c46c4cff` |
| Package / versions | `com.shostalab.banglartesla`, versionCode 11, versionName 0.6.7, minSdk 24 |
| `package.json` version | `0.6.7` |

**Important honesty note carried forward from the release body itself:** this is a
debug-signed test APK, not a Play Console artifact, and physical-device
performance/installation was never verified. No claim about device frame rate
exists or should be made.

---

## 2. Where the Unity experiment actually lives

This is the single most important correction to the working assumption.

| Location | Contains `unity/`? |
| --- | --- |
| `main` (`619a774`) | **No** |
| `v0.6.7` (`8379f25`) | **No** |
| Branch base `2dc02d7` | **No** |
| `arena/f78d620e-banglar-tesla` (this branch) | **Yes** |

Production is **already free of Unity**. `main`'s only workflows are
`android-apk.yml` and `deploy-pages.yml`. The entire Unity experiment was
developed on this branch and exists nowhere else on the remote.

Consequences:

1. There is nothing to remove from production. Cleanup is about this working
   branch, so that a future PR to `main` does not smuggle `unity/` back in.
2. The Unity lineage is **not yet archived**. Today it survives only as the tip
   of this branch (`d970bdf`). If this branch were reset, those commits would
   become unreachable.

### Archive procedure (requires the repo owner)

This agent must not create or push other branches. To archive before any cleanup:

```
git branch archive/unity-experiment d970bdfa4114984ced2d190d28e15fc189c1cb83
git push origin archive/unity-experiment
```

or use the GitHub UI: Branches → New branch → from
`arena/f78d620e-banglar-tesla`. A `d970bdf` tag is an equally valid anchor.
Until that ref exists, **no Unity deletion should run.**

---

## 3. Unity dependency audit (what is safe to remove)

Scope: everything added on this branch outside `unity/`.

| Path | Depends on Unity? | Needed by Three.js? | Verdict |
| --- | --- | --- | --- |
| `.github/workflows/unity-domain.yml` | Yes — dotnet tests of `unity/` | No | remove after archive |
| `.github/workflows/import-mohammadpur-map.yml` | Indirect — outputs into `unity/Assets/…` | No | remove after archive, **but** see OSM note |
| `.github/scripts/ci-test-annotate.py` | No — generic CI annotation | No direct use | keep or remove; verify before deleting |
| `docs/UNITY_*.md`, `docs/ci/` | Yes — Unity build research | No | move into archive |
| `scripts/audit-unity-csharp.py` | Yes — C# static audit | No | remove after archive |
| `scripts/import-mohammadpur-osm.py` | Produces Unity map JSON | No, **but** it is the only tool that turns OSM into game data | **keep or relocate** |
| `scripts/render-mohammadpur-minimap.py` | Produces Unity minimap PNG | No | keep or relocate (see below) |
| `scripts/generate-hud-icons.py` | Produces PNG icons | Possibly reusable | **verify** before deleting |
| `tests/map_import/` (2 files) | Tests the OSM importer | No | keep if importer is kept |
| `.gitignore` Unity block | n/a | Harmless | remove with the rest |

### Shared-resource warning — RESOLVED 2026-11-07

`mohammadpur.osm.json` was **3.9 MB of OpenStreetMap-derived Mohammadpur data**
(ODbL) and the raw source from which `src/world/mohammadpurData.ts` was derived.
Deleting `unity/` wholesale would have destroyed it.

It has now been relocated to `data/mohammadpur/mohammadpur.osm.json`, together
with its `ODBL_NOTICE.md` attribution file, and git recorded the move as a **100%
rename**, so history follows it.

At the moment of the move the file was byte-identical: SHA-256
`606d1817fb99c8e235e5d5851845a6ee8cd557fb139a13e6cd5c29a21767e29a`,
3,920,274 bytes either side.

**Note on hashing:** that hash is no longer current. Committing the relocated path
and the updated importer triggered `.github/workflows/import-mohammadpur-map.yml`,
which re-ran a live OSM import and committed the result as `3be7dd1`. Only the
retrieval metadata changed — `retrievedAt` and the two upstream payload checksums.
The substance is identical: 1610 roads, 2857 POIs, 129 boundary exits, and the Chan
Mia Housing node is still present. Current file hash:
`d7286d0e1b7d66489316c391fea314813c2bcb52f1345e1930b3c9ce4a0f6881`.

Do not pin a file hash in documentation that the importer can change on any run.
Pin the content invariants instead.

Updated consumers: `scripts/import-mohammadpur-osm.py`,
`scripts/render-mohammadpur-minimap.py`,
`.github/workflows/import-mohammadpur-map.yml`, `docs/GEOGRAPHIC_IMPORT_REPORT.md`.

Still to relocate in phase 4: `mohammadpur-minimap.png`, which is a produced work
rendered from this database and is named in the ODbL notice.

---

## 4. Production audit findings

Measured on the current tree.

### Test and build state (all green)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | pass, exit 0 |
| Unit tests | **236 / 236 passing** across 40 files |
| Android pipeline tests | **5 / 5 passing** |
| `vite build` | success — 1,252.62 kB JS (349.37 kB gzip), 45.85 kB CSS |
| Live site | serving the full game (Pages, deploy of `619a774`) |

### Code health (good)

- **Zero** real `TODO` / `FIXME` / `HACK` markers across 33,893 lines in 66 files.
- Only **10** `console.*` calls project-wide.
- Performance scaffolding already present: **50** `InstancedMesh` uses,
  **22** `frustumCulled` assignments, LOD logic, **30** `castShadow` sites.
- `src/world/mohammadpurData.ts` is explicit about provenance: **50 `source: 'osm'`
  edges** (with real OSM way IDs) and **22 `source: 'approx_lane'`** procedural
  connectors that are never mislabelled as survey data. Tajmahal Road, Ring Road,
  Salimullah, Sher Shah Suri, Asad Avenue, Satmasjid and Nurjahan are all modelled
  with plausible widths. This is honest and is the project's strongest asset.

### Defects and gaps found

| # | Severity | Finding |
| --- | --- | --- |
| P1 | S2 | `docs/KNOWN_ISSUES.md` is titled **0.1.0** and materially stale. It claims "One district only / Old-Dhaka-inspired block", but the world is now Mohammadpur with OSM-derived streets. Its S1/S2 lists no longer describe the shipped game. |
| P2 | S2 | `CHANGELOG.md` stops at **0.1.0** while the project ships **0.6.7**. Six minor versions of shipped work are undocumented (v0.5.0, v0.6.x passes), so there is no reliable written record of what changed. |
| P3 | S2 | **Chan Miya Housing is absent** — zero references in `src/` or `docs/`. It was a named landmark requirement alongside Tajmahal Road, and Tajmahal Road *is* present. This is a genuine content gap, not a bug. |
| P4 | S3 | ~~No `BufferGeometryUtils` / `mergeGeometries` usage (0 hits)~~ **Corrected 2026-11-07: this was wrong.** `mergeGeometries` is already used in `src/world/geo.ts` (5 occurrences, `BufferGeometryUtils` 2) and pooling appears 32 times. The original count came from a broken grep: `\|` inside `grep -E` matches a literal pipe, not alternation, so the pattern never matched. The real open question is narrower — whether the existing merge buckets are applied to *all* eligible static geometry — and remains unmeasured. |
| P5 | S3 | Main JS bundle is 1.25 MB raw / 349 kB gzip. Acceptable but likely dominated by three.js; worth a bundle analysis before adding features. |
| P6 | S1 | Unchanged and real: **no release-signed AAB**, and **no measured performance on a physical phone**. Cannot be closed from a headless sandbox. |

### What I am deliberately not claiming

No frame-rate figure, no device behaviour, no "playable on low-end Android"
statement. Every performance number in the project's own docs comes from
headless SwiftShader, and those documents say so — that standard is preserved.

---

## 5. Proposed execution order

Each step is one isolated commit on this branch. Nothing touches `main`.

1. **Archive anchor** — owner creates `archive/unity-experiment` at `d970bdf`
   (blocking for steps 3–4).
2. **Preserve shared data** — move the OSM JSON + ODBL notice to
   `data/mohammadpur/`, keep the importer scripts. No code references break,
   because only Unity code consumed the old path.
3. **Remove Unity from this branch** — delete `unity/`, the two Unity workflows,
   `docs/UNITY_*`, `docs/ci/`, and the `.gitignore` Unity block.
4. **Restore accurate documentation** — rewrite `KNOWN_ISSUES.md` and
   `CHANGELOG.md` against the 0.6.7 reality, including the six undocumented
   versions as far as git history supports.
5. **Content gap** — add Chan Miya Housing using the same `osm`/`approx_lane`
   provenance discipline already enforced in `world/mohammadpurData.ts`.
6. **Performance** — profile first (draw calls/triangles via the existing
   harness), then act only on measured wins.

Steps 2–4 are reversible and low-risk. Step 3 deletes ~196k lines from this
branch and is therefore **blocked on step 1**.

---

## 6. Decisions required before implementation

- **A.** Approve the archive branch at `d970bdf` (or supply a different anchor).
- **B.** Confirm relocating the OSM dataset to `data/mohammadpur/` rather than
  deleting it with `unity/`.
- **C.** Confirm priority between documentation repair (P1/P2) and content
  (P3, Chan Miya Housing). Documentation is the safer first move.
