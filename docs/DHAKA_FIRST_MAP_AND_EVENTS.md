# Research → existing map → interaction design (before implementation)

## Map audit (gameplay coordinates are compressed/approximate)

| Street type/node | Existing graph and place | Source support | Placement confidence/action |
|---|---|---|---|
| Mixed commercial connector | `asad_1`–`asad_6`, `town_hall` node (42,106), `place.bazaar` on `asad_3`; `shershah_1/2` and `shershah_cross` | Kabir 2023 Town Hall case study; Rahman/Nilufar 2024 Dhaka nodes; Razi 2026 market road | Relationship broadly consistent but **not** geospatially independently verified. Retain coordinates; no new landmark. |
| Market frontage | `place.market` on `ring_3`, `place.bazaar` on `asad_3`, vendor spots in `src/world/props.ts` | Kabir 2023 market functions; Razi 2026 market footpath | Existing game approximations, not measured inventory; avoid obstructive event props. |
| Residential blocks/lane | `nurjahan_1`, `salimullah_1`, `salimullah_link` (`approx_lane`), other `gali` segments | Kabir 2023 planned grid portions; Razi 2026 residential alley | Mark `approx_lane` as fictionalized connector; no assertion of exact lane or site. |
| Shaded local connections | `tajmahal_*`, residential tree props and sidewalk in `src/world/city.ts` | Razi 2026 shaded pedestrian lane | Visual interpretation only; not claimed to be the article's surveyed lane. |
| Major road/transport edge | `bus_stand`, `satmasjid_1`, `asad_gate_e` | UNESCAP 2019 vehicle mix; map's OSM attribution | Existing graph labels kept; OSM IDs in `mohammadpurData.ts` are **project claims**, not reverified live. |
| DRMC campus | `place.drmc` exterior on `shahjahan_2`, `drmc_side` POI and exactly two gate constants | Existing `drmc.ts`, `drmcGeo.ts` and regression | In-game interpretation, separate restricted campus; no civilian traffic/ped spawning inside. No event allowed inside or near either gate. |
| Sat Gambuj heritage | No verified matching in-game monument | Bangladesh Tourism Board | **Do not invent a mosque at an arbitrary coordinate.** Name remains research only. |

All roads/buildings/shops here are compact-scale and approximated; a formal georeferenced audit and on-location review remain outstanding.

## Existing-system audit and event interaction matrix

Existing `EventDirector` schedules traffic incidents, construction, vendor, police, weather, challenge and photo events; existing passenger system handles offers/bargaining/pickup/fare, police and rivals have their own progression. This pass improves safe event scheduling/cleanup without replacing traffic AI, race logic, collision physics, mission/economy, audio or saves. Current ৳ 500 starting balance and tested passenger earnings (+৳199 in baseline E2E) demonstrate existing economy; no rebalance or new reward loops. Existing score awards *impact/destruction* points, a safety issue; the event's photo moment must not award impact points.

| Family | Trigger/eligible context | Systems/choice/outcome | Cleanup/reward/test |
|---|---|---|---|
| Market-edge slowdown (not a fabricated crash) | Free roam, eligible `jamProne` public commercial graph segment, outside DRMC/race/mission | Existing `traffic.induceCongestionNear` briefly changes route-cost hints; advisory toast asks player to slow; no physically spawned vehicle | Nine-second director TTL, injected cost decays; no currency; deterministic and live-Game tests. |
| Weather cue | Free roam and auto-weather only for actual storm nudge; otherwise contextual notice | Existing weather lifecycle and wet driving; passenger job/race excluded | TTL cleanup, no persistent effect to revert; no fabricated location-specific flood. Test no blocked weather event. |
| Road-edge construction/checkpoint | **Disabled** in this pass: existing pooled barriers lack per-event ownership | Existing roadblocks remain available to police/races | Cannot safely claim director-owned cleanup without slot ownership; leave off rather than accidentally remove another system’s barricade. |
| Passenger waiting/bargaining | Existing pedestrian reserved at safe sidewalk point; only one offer and no race/police overlap | Mission, fare, boarding, mood and dialogue already implemented; retain localized UI | Existing 38-second expiry and stop cooldown; baseline E2E mission/payment/save proof; no new fare rewards. |
| Rival encounter | Existing authored race eligibility, far from event conflicts | Existing rival race/road graph/collision protections | Existing race cancellation and cooldown; no new route or false challenge. |
| Photo opportunity | Disabled pending a real player shutter action | Existing scrapbook cannot certify an unperformed photo | No fake capture or impact points; unit/browser test confirms not selected. |

**Director policy target:** seeded RNG hook; one active major event (no overlapping roadblock/roadside caller), global cooldown ≥ 90 simulation seconds; specific type cooldown ≥ 120 s; event lies on a *verified playable graph segment* at a safe distance from the player and gate, away from dead ends/junctions, and outside the campus. Filter unsafe kinds, do not announce an event that cannot be realized. Never snap vehicles or pedestrians; no player teleport. No new save fields, graphics assets, shader passes, event timers or DOM listeners. Expose no rigid guaranteed cadence. Low preset retains all event logic because events use existing systems. Feedback uses bilingual existing toast pattern; no synthesized spoken filler. Cleanup must not despawn another subsystem's resources. No save migration. Accessibility: short localized toast, optional/passable event, no forced control takeover.

## Baseline verification and visual evidence plan

Baseline prior to code: `npm run build`, `npm test -- --run` (34 files/222 tests), `npm run test:e2e` (21 checks), `npm run test:mobile` (13), `npm run test:ui` (33) completed. New 37-scene task-specific `artifacts/dhaka-first-pass/before/*.png` and `metrics.json` captured at 960×540, DPR1, deterministic seed, fixed camera/time/weather; fixture hides population, so **not** evidence of live crowd, passenger/race/police interactions. The baseline E2E exercises a live passenger, race/heat need separate tests. After capture should run the same fixture; a browser E2E should exercise live director events. Older gap-closure PNGs are historical and must not be overwritten.
