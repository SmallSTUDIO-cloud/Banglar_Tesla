/**
 * Offline Mohammadpur (Dhaka-1207) street-network & landmark dataset.
 *
 * Licensing & Honesty Note:
 * - Core road connectivity, street alignments, junction topology, road classes,
 *   and landmark locations are derived from OpenStreetMap data for Mohammadpur,
 *   Dhaka ("Data © OpenStreetMap contributors, licensed under ODbL 1.0",
 *   https://www.openstreetmap.org/copyright), projected around (23.7624°N,
 *   90.3646°E) at a compact 0.36x urban gameplay scale so players experience
 *   continuous Dhaka street density without multi-kilometre empty stretches.
 * - Segments with `source: 'osm'` correspond to verified OpenStreetMap ways
 *   (OSM way IDs recorded below). Segments with `source: 'approx_lane'` are
 *   clearly marked procedural residential connectors / narrow galis added for
 *   loop continuity and tactical jam detours, never mislabelled as exact survey
 *   ways. All buildings, shopfronts and props are procedural approximations.
 */

export type OsmSourceKind = 'osm' | 'approx_lane';
export type StreetCategory = 'main' | 'medium' | 'gali';

export interface RawMapNode {
  id: string;
  /** Local projected world X in metres (+X = East). */
  x: number;
  /** Local projected world Z in metres (-Z = North, +Z = South). */
  z: number;
  label?: string;
  signal?: boolean;
}

export interface RawMapEdge {
  id: string;
  from: string;
  to: string;
  nameEn: string;
  nameBn: string;
  kind: StreetCategory;
  width: number;
  sidewalk: number;
  source: OsmSourceKind;
  osmWayId?: number;
  /** True if this corridor is a natural commercial/market jam hotspot. */
  jamProne?: boolean;
}

/**
 * Projected Mohammadpur nodes (origin near Salimullah Rd / Sher Shah Suri Rd,
 * scaled 0.36x from WGS84 lat/lon around 23.7624N, 90.3646E).
 */
export const MOHAMMADPUR_NODES: RawMapNode[] = [
  // --- Southern Spine: Mohammadpur Bus Stand, Asad Avenue & Satmasjid Road ---
  { id: 'bus_stand', x: -112, z: 194, label: 'Mohammadpur Bus Stand', signal: true },
  { id: 'beribadh_w', x: -168, z: 204, label: 'Beribadh West Approach' },
  { id: 'satmasjid_mid', x: -58, z: 232, label: 'Satmasjid Road' },
  { id: 'satmasjid_se', x: 18, z: 248, label: 'Satmasjid / Lalmatia Edge' },

  // Asad Avenue (OSM way/565418929) SW -> NE -> E bend
  { id: 'asad_nurjahan', x: -70, z: 162, label: 'Asad Ave × Nurjahan Rd', signal: true },
  { id: 'asad_salimullah', x: -15, z: 132, label: 'Asad Ave × Salimullah Rd', signal: true },
  { id: 'town_hall', x: 42, z: 106, label: 'Town Hall Market Junction', signal: true },
  { id: 'asad_post', x: 118, z: 84, label: 'Asad Ave Post Office' },
  { id: 'asad_iqbal', x: 196, z: 82, label: 'Asad Ave × Iqbal Rd', signal: true },
  { id: 'asad_gate_e', x: 242, z: 78, label: 'Asad Gate Approach' },

  // Zakir Hossain Road south of Asad Ave (OSM way/33798055, way/33798152)
  { id: 'zakir_w', x: 16, z: 176, label: 'Zakir Hossain Living Street' },
  { id: 'zakir_e', x: 96, z: 168, label: 'Zakir Hossain Road' },
  { id: 'zakir_s', x: 112, z: 236, label: 'Zakir Hossain South' },

  // --- Western Spine: Ring Road & Shia Mosque / Krishi Market (OSM way/33832973) ---
  { id: 'ring_south', x: -204, z: 96, label: 'Ring Road South' },
  { id: 'ring_nurjahan', x: -208, z: 42, label: 'Ring Rd × Nurjahan West' },
  { id: 'ring_tajmahal', x: -212, z: -56, label: 'Shia Mosque / Ring × Tajmahal', signal: true },
  { id: 'ring_humayun', x: -216, z: -106, label: 'Ring Rd × Humayun Rd', signal: true },
  { id: 'ring_north', x: -218, z: -196, label: 'Ring Rd North (Tikkapara)' },

  // --- Central Grid-Fan: Nurjahan, Salimullah, Sher Shah Suri & Iqbal Roads ---
  { id: 'nurjahan_mid', x: -98, z: 54, label: 'Nurjahan Road Mid' },
  { id: 'nurjahan_north', x: -134, z: -26, label: 'Nurjahan × Tajmahal South' },

  { id: 'salimullah_mid', x: -42, z: 34, label: 'Salimullah Road Mid' },
  { id: 'salimullah_north', x: -74, z: -42, label: 'Salimullah × Tajmahal Rd', signal: true },

  { id: 'shershah_mid', x: 14, z: 18, label: 'Sher Shah Suri Mid', signal: true },
  { id: 'shershah_spur_e', x: 74, z: 4, label: 'Sher Shah Suri East Bazar Spur' }, // genuine dead-end living_street!
  { id: 'shershah_north', x: -16, z: -58, label: 'Sher Shah Suri × Tajmahal', signal: true },

  { id: 'shahjahan_s', x: 58, z: -22, label: 'Shahjahan × Aurangzeb Junction' },
  { id: 'aurangzeb_mid', x: 134, z: -38, label: 'Aurangzeb Road' },
  { id: 'iqbal_north', x: 208, z: -4, label: 'Iqbal Road North' },
  { id: 'iqbal_aurangzeb', x: 214, z: -58, label: 'Aurangzeb East' },

  // --- Tajmahal Road Corridor (OSM way/33085581, 24692351, 33085726) ---
  { id: 'tajmahal_w', x: -148, z: -78, label: 'Tajmahal Road West' },
  { id: 'tajmahal_e', x: -12, z: -112, label: 'Tajmahal × Shahjahan North' },
  { id: 'aziz_gali', x: -86, z: -96, label: 'Aziz Moholla Lane' },

  // --- Northern Spine: Humayun Road & Babar / Babor Road (OSM way/32766053, 33393815) ---
  { id: 'humayun_w', x: -126, z: -136, label: 'Humayun Road West' },
  { id: 'humayun_shahjahan', x: 6, z: -168, label: 'Humayun × Shahjahan' },
  { id: 'humayun_e', x: 84, z: -188, label: 'Humayun Road East' },
  { id: 'humayun_far_e', x: 162, z: -172, label: 'Geneva Camp East Connector' },

  { id: 'babar_w', x: -138, z: -214, label: 'Babar Road West (Block F)' },
  { id: 'babar_mid', x: -18, z: -228, label: 'Babar Road Mid (Johuri Moholla)' },
  { id: 'babar_humayun', x: 56, z: -236, label: 'Babar × Humayun North', signal: true },
  { id: 'babar_e', x: 146, z: -244, label: 'Babar Road East (Block B)' },
  { id: 'johuri_deadend', x: -18, z: -256, label: 'Johuri Moholla Cul-de-sac' }, // dead end!
];

export const MOHAMMADPUR_EDGES: RawMapEdge[] = [
  // Asad Avenue (OSM way/565418929 — secondary commercial arterial)
  { id: 'asad_0', from: 'beribadh_w', to: 'bus_stand', nameEn: 'Beribadh Connecting Rd', nameBn: 'বেড়িবাঁধ সংযোগ সড়ক', kind: 'main', width: 11.5, sidewalk: 2.6, source: 'osm', osmWayId: 565418929 },
  { id: 'asad_1', from: 'bus_stand', to: 'asad_nurjahan', nameEn: 'Asad Avenue', nameBn: 'আসাদ এভেনিউ', kind: 'main', width: 12.2, sidewalk: 2.8, source: 'osm', osmWayId: 565418929, jamProne: true },
  { id: 'asad_2', from: 'asad_nurjahan', to: 'asad_salimullah', nameEn: 'Asad Avenue', nameBn: 'আসাদ এভেনিউ', kind: 'main', width: 12.2, sidewalk: 2.8, source: 'osm', osmWayId: 565418929, jamProne: true },
  { id: 'asad_3', from: 'asad_salimullah', to: 'town_hall', nameEn: 'Asad Avenue', nameBn: 'আসাদ এভেনিউ', kind: 'main', width: 12.4, sidewalk: 3.0, source: 'osm', osmWayId: 565418929, jamProne: true },
  { id: 'asad_4', from: 'town_hall', to: 'asad_post', nameEn: 'Asad Avenue', nameBn: 'আসাদ এভেনিউ', kind: 'main', width: 12.2, sidewalk: 2.8, source: 'osm', osmWayId: 565418929, jamProne: true },
  { id: 'asad_5', from: 'asad_post', to: 'asad_iqbal', nameEn: 'Asad Avenue', nameBn: 'আসাদ এভেনিউ', kind: 'main', width: 12.0, sidewalk: 2.8, source: 'osm', osmWayId: 565418929 },
  { id: 'asad_6', from: 'asad_iqbal', to: 'asad_gate_e', nameEn: 'Asad Avenue', nameBn: 'আসাদ এভেনিউ', kind: 'main', width: 12.0, sidewalk: 2.6, source: 'osm', osmWayId: 565418929 },

  // Satmasjid Road (OSM way/32252440 — secondary road SE from Bus Stand)
  { id: 'satmasjid_1', from: 'bus_stand', to: 'satmasjid_mid', nameEn: 'Satmasjid Road', nameBn: 'সাতমসজিদ রোড', kind: 'main', width: 11.4, sidewalk: 2.6, source: 'osm', osmWayId: 32252440, jamProne: true },
  { id: 'satmasjid_2', from: 'satmasjid_mid', to: 'satmasjid_se', nameEn: 'Satmasjid Road', nameBn: 'সাতমসজিদ রোড', kind: 'main', width: 11.4, sidewalk: 2.6, source: 'osm', osmWayId: 32252440 },

  // Zakir Hossain Road & Lalmatia lanes (OSM way/33798055, 33798152)
  { id: 'zakir_1', from: 'town_hall', to: 'zakir_w', nameEn: 'Zakir Hossain Road', nameBn: 'জাকির হোসেন রোড', kind: 'gali', width: 6.4, sidewalk: 1.8, source: 'osm', osmWayId: 33798152 },
  { id: 'zakir_2', from: 'zakir_w', to: 'satmasjid_mid', nameEn: 'Zakir Hossain Lane', nameBn: 'জাকির হোসেন গলি', kind: 'gali', width: 6.2, sidewalk: 1.7, source: 'approx_lane' },
  { id: 'zakir_3', from: 'asad_post', to: 'zakir_e', nameEn: 'Zakir Hossain Road', nameBn: 'জাকির হোসেন রোড', kind: 'medium', width: 7.8, sidewalk: 2.1, source: 'osm', osmWayId: 33798055 },
  { id: 'zakir_4', from: 'zakir_e', to: 'zakir_s', nameEn: 'Zakir Hossain Road', nameBn: 'জাকির হোসেন রোড', kind: 'medium', width: 7.8, sidewalk: 2.1, source: 'osm', osmWayId: 33798055 },
  { id: 'zakir_5', from: 'zakir_w', to: 'zakir_e', nameEn: 'Lalmatia Block-A Lane', nameBn: 'লালমাটিয়া এ-ব্লক গলি', kind: 'gali', width: 6.2, sidewalk: 1.8, source: 'approx_lane' },
  { id: 'zakir_6', from: 'satmasjid_se', to: 'zakir_s', nameEn: 'Lalmatia Connector', nameBn: 'লালমাটিয়া সংযোগ সড়ক', kind: 'medium', width: 7.6, sidewalk: 2.0, source: 'approx_lane' },

  // Ring Road (OSM way/33832973 — western Mohammadpur arterial)
  { id: 'ring_0', from: 'beribadh_w', to: 'ring_south', nameEn: 'Ring Road Link', nameBn: 'রিং রোড সংযোগ', kind: 'medium', width: 9.2, sidewalk: 2.3, source: 'approx_lane' },
  { id: 'ring_1', from: 'ring_south', to: 'ring_nurjahan', nameEn: 'Ring Road', nameBn: 'রিং রোড', kind: 'main', width: 11.2, sidewalk: 2.7, source: 'osm', osmWayId: 33832973 },
  { id: 'ring_2', from: 'ring_nurjahan', to: 'ring_tajmahal', nameEn: 'Ring Road', nameBn: 'রিং রোড', kind: 'main', width: 11.2, sidewalk: 2.7, source: 'osm', osmWayId: 33832973, jamProne: true },
  { id: 'ring_3', from: 'ring_tajmahal', to: 'ring_humayun', nameEn: 'Ring Road', nameBn: 'রিং রোড', kind: 'main', width: 11.2, sidewalk: 2.7, source: 'osm', osmWayId: 33832973 },
  { id: 'ring_4', from: 'ring_humayun', to: 'ring_north', nameEn: 'Ring Road', nameBn: 'রিং রোড', kind: 'main', width: 11.0, sidewalk: 2.6, source: 'osm', osmWayId: 33832973 },

  // Nurjahan Road (OSM way/409575563 & way/33087570)
  { id: 'nurjahan_1', from: 'asad_nurjahan', to: 'nurjahan_mid', nameEn: 'Nurjahan Road', nameBn: 'নূরজাহান রোড', kind: 'medium', width: 8.6, sidewalk: 2.2, source: 'osm', osmWayId: 409575563 },
  { id: 'nurjahan_2', from: 'nurjahan_mid', to: 'nurjahan_north', nameEn: 'Nurjahan Road', nameBn: 'নূরজাহান রোড', kind: 'medium', width: 8.6, sidewalk: 2.2, source: 'osm', osmWayId: 409575563 },
  { id: 'nurjahan_w', from: 'nurjahan_mid', to: 'ring_nurjahan', nameEn: 'Nurjahan Road West', nameBn: 'নূরজাহান পশ্চিম গলি', kind: 'medium', width: 7.8, sidewalk: 2.0, source: 'osm', osmWayId: 33087570 },
  { id: 'chanmia_s', from: 'bus_stand', to: 'ring_south', nameEn: 'Chanmia Housing Rd', nameBn: 'চাঁনমিয়া হাউজিং রোড', kind: 'gali', width: 6.4, sidewalk: 1.8, source: 'approx_lane' },

  // Salimullah Road (OSM way/33085032)
  { id: 'salimullah_1', from: 'asad_salimullah', to: 'salimullah_mid', nameEn: 'Salimullah Road', nameBn: 'সলিমুল্লাহ রোড', kind: 'medium', width: 8.4, sidewalk: 2.2, source: 'osm', osmWayId: 33085032 },
  { id: 'salimullah_2', from: 'salimullah_mid', to: 'salimullah_north', nameEn: 'Salimullah Road', nameBn: 'সলিমুল্লাহ রোড', kind: 'medium', width: 8.4, sidewalk: 2.2, source: 'osm', osmWayId: 33085032 },
  { id: 'salimullah_link', from: 'nurjahan_mid', to: 'salimullah_mid', nameEn: 'Salimullah Cross Lane', nameBn: 'সলিমুল্লাহ সংযোগ গলি', kind: 'gali', width: 6.0, sidewalk: 1.8, source: 'approx_lane' },

  // Sher Shah Suri Road (OSM way/626866197, 627468152, 627536895 — Town Hall market spine)
  { id: 'shershah_1', from: 'town_hall', to: 'shershah_mid', nameEn: 'Sher Shah Suri Road', nameBn: 'শেরশাহ সূরী রোড', kind: 'medium', width: 9.2, sidewalk: 2.5, source: 'osm', osmWayId: 626866197, jamProne: true },
  { id: 'shershah_2', from: 'shershah_mid', to: 'shershah_north', nameEn: 'Sher Shah Suri Road', nameBn: 'শেরশাহ সূরী রোড', kind: 'medium', width: 9.0, sidewalk: 2.4, source: 'osm', osmWayId: 626866197, jamProne: true },
  { id: 'shershah_cross', from: 'salimullah_mid', to: 'shershah_mid', nameEn: 'Town Hall Bazar Gali', nameBn: 'টাউন হল বাজার গলি', kind: 'gali', width: 6.2, sidewalk: 1.8, source: 'osm', osmWayId: 627468152 },
  { id: 'shershah_deadend', from: 'shershah_mid', to: 'shershah_spur_e', nameEn: 'Sher Shah Suri Bazar Cul-de-sac', nameBn: 'শেরশাহ সূরী কাঁচাবাজার গলি', kind: 'gali', width: 6.0, sidewalk: 1.8, source: 'osm', osmWayId: 627536895 },

  // Tajmahal Road (OSM way/33085581, 24692351, 33085726)
  { id: 'tajmahal_1', from: 'ring_tajmahal', to: 'tajmahal_w', nameEn: 'Tajmahal Road', nameBn: 'তাজমহল রোড', kind: 'medium', width: 9.2, sidewalk: 2.4, source: 'osm', osmWayId: 33085726 },
  { id: 'tajmahal_2', from: 'tajmahal_w', to: 'nurjahan_north', nameEn: 'Tajmahal Road', nameBn: 'তাজমহল রোড', kind: 'medium', width: 9.0, sidewalk: 2.3, source: 'osm', osmWayId: 24692351 },
  { id: 'tajmahal_3', from: 'nurjahan_north', to: 'salimullah_north', nameEn: 'Tajmahal Road', nameBn: 'তাজমহল রোড', kind: 'medium', width: 9.2, sidewalk: 2.4, source: 'osm', osmWayId: 33085581 },
  { id: 'tajmahal_4', from: 'salimullah_north', to: 'shershah_north', nameEn: 'Tajmahal Road', nameBn: 'তাজমহল রোড', kind: 'medium', width: 9.2, sidewalk: 2.4, source: 'osm', osmWayId: 33085581, jamProne: true },
  { id: 'tajmahal_5', from: 'shershah_north', to: 'tajmahal_e', nameEn: 'Tajmahal Road', nameBn: 'তাজমহল রোড', kind: 'medium', width: 8.8, sidewalk: 2.2, source: 'osm', osmWayId: 33085581 },
  { id: 'aziz_1', from: 'tajmahal_w', to: 'aziz_gali', nameEn: 'Aziz Moholla Lane', nameBn: 'আজিজ মহল্লা গলি', kind: 'gali', width: 5.8, sidewalk: 1.7, source: 'approx_lane' },
  { id: 'aziz_2', from: 'aziz_gali', to: 'tajmahal_e', nameEn: 'Aziz Moholla Lane', nameBn: 'আজিজ মহল্লা গলি', kind: 'gali', width: 5.8, sidewalk: 1.7, source: 'osm', osmWayId: 24706208 },
  { id: 'aziz_3', from: 'salimullah_north', to: 'aziz_gali', nameEn: 'Aziz Moholla Cross', nameBn: 'আজিজ মহল্লা মোড় গলি', kind: 'gali', width: 5.8, sidewalk: 1.7, source: 'approx_lane' },

  // Shahjahan Road, Aurangzeb Road & Iqbal Road (OSM way/33832997, 1193710462, 33085132)
  { id: 'shahjahan_1', from: 'shershah_north', to: 'shahjahan_s', nameEn: 'Shahjahan Road', nameBn: 'শাহজাহান রোড', kind: 'medium', width: 8.6, sidewalk: 2.2, source: 'osm', osmWayId: 33832997 },
  { id: 'shahjahan_2', from: 'shahjahan_s', to: 'tajmahal_e', nameEn: 'Shahjahan Road', nameBn: 'শাহজাহান রোড', kind: 'medium', width: 8.6, sidewalk: 2.2, source: 'osm', osmWayId: 33832997 },
  { id: 'shahjahan_3', from: 'tajmahal_e', to: 'humayun_shahjahan', nameEn: 'Shahjahan Road', nameBn: 'শাহজাহান রোড', kind: 'medium', width: 8.6, sidewalk: 2.2, source: 'osm', osmWayId: 33832997 },
  { id: 'post_shahjahan', from: 'asad_post', to: 'shahjahan_s', nameEn: 'Block-A Post Office Rd', nameBn: 'পোস্ট অফিস সড়ক', kind: 'gali', width: 6.6, sidewalk: 1.9, source: 'approx_lane' },
  { id: 'aurangzeb_1', from: 'shahjahan_s', to: 'aurangzeb_mid', nameEn: 'Aurangzeb Road', nameBn: 'আওরঙ্গজেব রোড', kind: 'medium', width: 8.8, sidewalk: 2.2, source: 'osm', osmWayId: 1193710462 },
  { id: 'aurangzeb_2', from: 'aurangzeb_mid', to: 'iqbal_aurangzeb', nameEn: 'Aurangzeb Road', nameBn: 'আওরঙ্গজেব রোড', kind: 'medium', width: 8.8, sidewalk: 2.2, source: 'osm', osmWayId: 1193710462 },
  { id: 'iqbal_1', from: 'asad_iqbal', to: 'iqbal_north', nameEn: 'Iqbal Road', nameBn: 'ইকবাল রোড', kind: 'medium', width: 8.4, sidewalk: 2.3, source: 'osm', osmWayId: 33085132 },
  { id: 'iqbal_2', from: 'iqbal_north', to: 'iqbal_aurangzeb', nameEn: 'Iqbal Road', nameBn: 'ইকবাল রোড', kind: 'medium', width: 8.4, sidewalk: 2.3, source: 'osm', osmWayId: 33085132 },
  { id: 'iqbal_gate', from: 'asad_gate_e', to: 'iqbal_north', nameEn: 'Asad Gate Link', nameBn: 'আসাদ গেট গলি', kind: 'gali', width: 6.4, sidewalk: 1.8, source: 'osm', osmWayId: 32561554 },

  // Humayun Road (OSM way/32766053, 33393944, 33393820)
  { id: 'humayun_1', from: 'ring_humayun', to: 'humayun_w', nameEn: 'Humayun Road', nameBn: 'হুমায়ুন রোড', kind: 'medium', width: 8.4, sidewalk: 2.2, source: 'osm', osmWayId: 32766053 },
  { id: 'humayun_2', from: 'humayun_w', to: 'humayun_shahjahan', nameEn: 'Humayun Road', nameBn: 'হুমায়ুন রোড', kind: 'medium', width: 8.4, sidewalk: 2.2, source: 'osm', osmWayId: 32766053 },
  { id: 'humayun_3', from: 'humayun_shahjahan', to: 'humayun_e', nameEn: 'Humayun Road', nameBn: 'হুমায়ুন রোড', kind: 'medium', width: 8.4, sidewalk: 2.2, source: 'osm', osmWayId: 33393944 },
  { id: 'humayun_4', from: 'humayun_e', to: 'humayun_far_e', nameEn: 'Humayun Road', nameBn: 'হুমায়ুন রোড', kind: 'medium', width: 8.0, sidewalk: 2.1, source: 'osm', osmWayId: 33393944 },
  { id: 'humayun_taj', from: 'tajmahal_w', to: 'humayun_w', nameEn: 'Block-C Mosque Lane', nameBn: 'ব্লক-সি মসজিদ গলি', kind: 'gali', width: 6.2, sidewalk: 1.8, source: 'approx_lane' },
  { id: 'aurangzeb_humayun', from: 'aurangzeb_mid', to: 'humayun_e', nameEn: 'Geneva Camp East Rd', nameBn: 'জেনেভা ক্যাম্প পূর্ব সড়ক', kind: 'gali', width: 6.6, sidewalk: 1.8, source: 'approx_lane' },
  { id: 'iqbal_humayun', from: 'iqbal_aurangzeb', to: 'humayun_far_e', nameEn: 'College Gate North Rd', nameBn: 'কলেজ গেট সংযোগ সড়ক', kind: 'medium', width: 8.0, sidewalk: 2.0, source: 'approx_lane' },

  // Babar / Babor Road (OSM way/33393815, 33397465, 608263619 — Johuri Moholla northern Mohammadpur)
  { id: 'babar_0', from: 'ring_north', to: 'babar_w', nameEn: 'Babar Road West', nameBn: 'বাবর রোড পশ্চিম', kind: 'medium', width: 8.6, sidewalk: 2.2, source: 'osm', osmWayId: 608263619 },
  { id: 'babar_1', from: 'babar_w', to: 'babar_mid', nameEn: 'Babar Road', nameBn: 'বাবর রোড', kind: 'medium', width: 9.0, sidewalk: 2.3, source: 'osm', osmWayId: 608263619 },
  { id: 'babar_2', from: 'babar_mid', to: 'babar_humayun', nameEn: 'Babar Road', nameBn: 'বাবর রোড', kind: 'medium', width: 9.0, sidewalk: 2.3, source: 'osm', osmWayId: 33393815 },
  { id: 'babar_3', from: 'babar_humayun', to: 'babar_e', nameEn: 'Babar Road', nameBn: 'বাবর রোড', kind: 'medium', width: 9.0, sidewalk: 2.3, source: 'osm', osmWayId: 33393815 },
  { id: 'babar_link_w', from: 'humayun_w', to: 'babar_w', nameEn: 'Kaderia Madrasa Rd', nameBn: 'কাদেরিয়া মাদ্রাসা রোড', kind: 'gali', width: 6.4, sidewalk: 1.8, source: 'approx_lane' },
  { id: 'babar_link_m', from: 'humayun_shahjahan', to: 'babar_mid', nameEn: 'Johuri Moholla Rd', nameBn: 'জহুরি মহল্লা রোড', kind: 'gali', width: 6.4, sidewalk: 1.8, source: 'approx_lane' },
  { id: 'babar_link_h', from: 'humayun_e', to: 'babar_humayun', nameEn: 'Humayun North Link', nameBn: 'হুমায়ুন উত্তর সড়ক', kind: 'medium', width: 8.0, sidewalk: 2.1, source: 'osm', osmWayId: 33393820 },
  { id: 'babar_link_e', from: 'humayun_far_e', to: 'babar_e', nameEn: 'Block-B East Rd', nameBn: 'ব্লক-বি পূর্ব সড়ক', kind: 'medium', width: 7.8, sidewalk: 2.0, source: 'approx_lane' },
  { id: 'babar_deadend', from: 'babar_mid', to: 'johuri_deadend', nameEn: 'Johuri Moholla Cul-de-sac', nameBn: 'জহুরি মহল্লা শেষ গলি', kind: 'gali', width: 5.8, sidewalk: 1.7, source: 'osm', osmWayId: 608234627 },
];

export const OSM_ATTRIBUTION =
  'Street network & landmarks derived from OpenStreetMap contributors (ODbL 1.0); buildings & props procedurally generated.';
