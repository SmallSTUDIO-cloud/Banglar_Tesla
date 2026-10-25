# Content roadmap (post vertical slice)

Ordered by player-visible value per unit of work. Nothing here is claimed as implemented.

## Phase 2 — depth in the existing district

1. **More passenger stories.** 4–6 recurring characters with a small memory of previous rides
   (keys already live in `src/core/i18n.ts`; the mission generator already carries an archetype).
2. **Mission types beyond passenger delivery:** fragile parcel/food delivery (bump-sensitive),
   multi-stop route, lost-item return, market supply run, mechanic pickup. The `MissionOffer`
   shape is designed to carry `type` and optional objectives.
3. **Dynamic street events:** moving shower cloud, bus stopping at a stand, vendor cart crossing,
   roadwork detour with cones, market crowd surge, and the “destination changed” gag with a
   *Dhaka GPS recalculating…* sting.
4. **Achievements screen** reading `progress.achievements` (data already persisted).
5. **Photo mode:** freeze the world, free camera, FOV slider, film-frame overlay, and a
   share-sheet export of the captured framebuffer.
6. **More rickshaw art sets** (festival, cinema poster variants, monsoon) and more cosmetics:
   dashboards, wheel trims, headlamp styles, canopy fabrics.
7. **Better interiors:** shallow shop rooms you can see into, with counters, shelves and lights.

## Phase 3 — Dhaka grows

8. **District B — Sadarghat-inspired riverfront.** Launch/boat silhouettes, warehouses, wholesale
   shops, handcarts, humid haze, birds. The map already has a riverfront stub in the north.
9. **District C — Gulistan/Motijheel-inspired commercial corridor.** Wider roads, bus bottlenecks,
   dense signage, service lanes.
10. **District D — Farmgate/Shahbagh connector.** Bigger junctions, bus stops, crossings, trees.
11. **District E — Dhanmondi-inspired residential streets.** Apartments, pharmacies, schools,
    small parks, quieter roads.
12. **District F — Hatirjheel-inspired scenic route.** Water, bridges, blue-hour lights,
    photo spots.
13. **Hub/route system** instead of one giant scene: travel between districts via a stylised map.

## Phase 4 — systems & polish

14. **Traffic that negotiates,** not just follows: intersection reservation, lane changes,
    alternate routing, spontaneous jams that clear.
15. **Crime-free ambient life:** cats, crows, pigeons with cheap behaviour; rooftop laundry;
    shopkeepers reacting to the rickshaw.
16. **Weather depth:** wet-road reflections on High only, rain on canopy audio, grip differences
    surfaced in the HUD, monsoon challenge missions.
17. **Progression:** district unlocks, titles, music tapes beyond three, local challenge records.
18. **Performance** on real device tiers with the developer overlay (already present behind
    `settings.showPerformance`).

## Explicitly out of scope for this game

Multiplayer, online accounts, ads, loot boxes, energy timers, real-money purchases, location
permissions, telemetry. The brief forbids them and they do not serve the fantasy.
