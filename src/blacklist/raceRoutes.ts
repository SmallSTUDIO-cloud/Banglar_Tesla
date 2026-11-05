/**
 * Purpose-Built Mohammadpur Race-Map Courses, Shortcuts, 4-Rickshaw Grid
 * Formation & Route Validation (v0.5.0 — Section 26 + Race-Map Architecture).
 *
 * Every course is authored directly over the Mohammadpur OpenStreetMap road
 * graph (`MOHAMMADPUR_NODES` / `MOHAMMADPUR_EDGES`) with:
 *   - Spacious, straight start/finish corridors for a collision-free 4-rickshaw
 *     staggered 2×2 starting grid (zero sidewalk/building/racer overlap)
 *   - Readable racing lines mixing wide overtaking/Turbo avenues (`11.0–12.4m`),
 *     medium market spines (`8.4–9.2m`), culvert elevation crests, and tight
 *     technical `gali` corners (`5.8–6.4m`)
 *   - High-risk, high-reward Mohammadpur shortcuts (`bazar_cut_*`, `krishi_cut_*`,
 *     `aziz_*`, `lalmatia_cut`, `johuri_bypass`) that save measurable distance
 *     for skilled drivers and `shortcut_seeker` AI rivals without breaking
 *     mandatory checkpoint validation!
 */

import { clamp } from '../core/mathx';
import {
  distanceToRoadCarriageway,
  findRoute,
  nodeById,
  placeById,
  ROAD_SEGMENTS,
  segmentById,
  snapToNearestRoad,
  type RoadSegment,
} from '../world/layout';
import type { RivalEventSpec } from './blacklistCatalog';

export type AiRacingTendency = 'clean_line' | 'aggressive_overtaker' | 'shortcut_seeker';

export interface RaceGate {
  id: string;
  x: number;
  z: number;
  /** Forward heading (radians) through this gate toward the next section. */
  yaw: number;
  /** Capture radius (metres) generously spanning the full carriageway width. */
  radius: number;
  /** Optional shortcut via-node IDs between the PREVIOUS gate (or start) and THIS gate. */
  shortcutViaNodeId?: string;
  /** True if the section AFTER this gate is a wide Turbo / overtaking straight. */
  turboZoneAfter?: boolean;
  labelBn?: string;
  labelEn?: string;
}

export interface CourseShortcutInfo {
  id: string;
  nameBn: string;
  nameEn: string;
  fromNodeId: string;
  viaNodeId: string;
  toNodeId: string;
  mainDistanceM: number;
  shortcutDistanceM: number;
}

export interface GridSlotPose {
  slotIndex: 0 | 1 | 2 | 3; // 0..2 = AI rivals ahead, 3 = player
  x: number;
  z: number;
  yaw: number;
}

export interface BuiltRaceCourse {
  eventId: string;
  laps: number;
  isCircuit: boolean;
  /** The authored launch corridor and direction, not the nearest graph node. */
  startSegmentId: string;
  startDirection: 1 | -1;
  startBanner: { x: number; z: number; yaw: number; width: number };
  finishBanner: { x: number; z: number; yaw: number; width: number };
  /** Validated 4-racer staggered 2×2 starting grid (`slots[0..2]` = AI, `slots[3]` = Player). */
  gridSlots: [GridSlotPose, GridSlotPose, GridSlotPose, GridSlotPose];
  /** Gates for a single lap (for `laps > 1`, `allCheckpoints` repeats `gates` per lap). */
  lapGates: RaceGate[];
  /** Flattened sequence of all mandatory gates across all laps. */
  allCheckpoints: RaceGate[];
  /** Documented high-risk shortcuts available along this course. */
  shortcuts: CourseShortcutInfo[];
  /** Total main-line driving distance in metres across all laps. */
  totalDistanceM: number;
}

interface AuthoredCourseBlueprint {
  eventId: string;
  laps: number;
  startSegmentId: string;
  /** Fractional position `[0.22..0.78]` of the front grid row along `startSegmentId`. */
  startFrac: number;
  /** `+1` = `from -> to` direction of `startSegmentId`, `-1` = `to -> from`. */
  startDir: 1 | -1;
  /** Ordered sequence of graph node IDs or `place:<id>` anchors forming one lap. */
  gateAnchors: {
    ref: string; // nodeId or `place:id`
    shortcutViaNodeId?: string;
    turboZoneAfter?: boolean;
    labelBn?: string;
    labelEn?: string;
  }[];
  shortcuts?: {
    id: string;
    nameBn: string;
    nameEn: string;
    fromNodeId: string;
    viaNodeId: string;
    toNodeId: string;
  }[];
}

const AUTHORED_COURSES: Record<string, AuthoredCourseBlueprint> = {
  // #10 Kana Galir Raju — Technical Gali & Shortcut Showdown
  bl_boss_10: {
    eventId: 'bl_boss_10',
    laps: 1,
    startSegmentId: 'zakir_3',
    startFrac: 0.62,
    startDir: -1,
    gateAnchors: [
      { ref: 'town_hall', labelBn: 'টাউন হল মোড়', labelEn: 'Town Hall Turn' },
      {
        ref: 'salimullah_mid',
        shortcutViaNodeId: 'shershah_mid',
        labelBn: 'সলিমুল্লাহ গলি',
        labelEn: 'Salimullah Lane',
      },
      {
        ref: 'nurjahan_mid',
        shortcutViaNodeId: 'salimullah_mid',
        turboZoneAfter: true,
        labelBn: 'নূরজাহান মধ্য মোড়',
        labelEn: 'Nurjahan Mid',
      },
      { ref: 'place:tea', labelBn: 'নূরজাহান চায়ের মোড় ফিনিশ', labelEn: 'Nurjahan Tea Finish' },
    ],
    shortcuts: [
      {
        id: 'sc_bazar_gali_10',
        nameBn: 'টাউন হল বাজার গলি শর্টকাট',
        nameEn: 'Town Hall Bazar Gali Cut',
        fromNodeId: 'town_hall',
        viaNodeId: 'shershah_mid',
        toNodeId: 'salimullah_mid',
      },
    ],
  },

  // #9 Ghonta Sumon — Bus Stand -> Town Hall Congestion Threader
  bl_boss_09: {
    eventId: 'bl_boss_09',
    laps: 1,
    startSegmentId: 'asad_1',
    startFrac: 0.42,
    startDir: 1,
    gateAnchors: [
      { ref: 'asad_salimullah', turboZoneAfter: true, labelBn: 'আসাদ অ্যাভিনিউ স্প্রিন্ট', labelEn: 'Asad Ave Sprint' },
      { ref: 'town_hall', labelBn: 'টাউন হল বাজার গেট', labelEn: 'Town Hall Gate' },
      {
        ref: 'shahjahan_s',
        shortcutViaNodeId: 'shershah_spur_e',
        labelBn: 'শাহজাহান মোড় ফিনিশ',
        labelEn: 'Shahjahan Finish',
      },
    ],
    shortcuts: [
      {
        id: 'sc_kachabazar_09',
        nameBn: 'কাঁচাবাজার পেছনের গলি',
        nameEn: 'Kacha Bazar Back-Alley Cut',
        fromNodeId: 'shershah_mid',
        viaNodeId: 'shershah_spur_e',
        toNodeId: 'shahjahan_s',
      },
    ],
  },

  // #8 Bijli Tarek — Salimullah -> Iqbal High-Acceleration Sprint
  bl_boss_08: {
    eventId: 'bl_boss_08',
    laps: 1,
    startSegmentId: 'salimullah_1',
    startFrac: 0.42,
    startDir: 1,
    gateAnchors: [
      { ref: 'salimullah_north', labelBn: 'তাজমহল মোড়', labelEn: 'Tajmahal Cross' },
      {
        ref: 'shahjahan_s',
        shortcutViaNodeId: 'aziz_gali',
        turboZoneAfter: true,
        labelBn: 'শাহজাহান কর্নার',
        labelEn: 'Shahjahan Corner',
      },
      { ref: 'iqbal_north', turboZoneAfter: true, labelBn: 'ইকবাল স্কুল স্ট্রেইট', labelEn: 'Iqbal School Straight' },
      { ref: 'asad_post', labelBn: 'পোস্ট অফিস ফিনিশ', labelEn: 'Post Office Finish' },
    ],
    shortcuts: [
      {
        id: 'sc_aziz_08',
        nameBn: 'আজিজ মহল্লা গলি শর্টকাট',
        nameEn: 'Aziz Moholla Shortcut',
        fromNodeId: 'tajmahal_w',
        viaNodeId: 'aziz_gali',
        toNodeId: 'tajmahal_e',
      },
    ],
  },

  // #7 Current Nabila — 2-Lap High-Voltage Tajmahal & Shia Mosque Circuit!
  bl_boss_07: {
    eventId: 'bl_boss_07',
    laps: 2,
    startSegmentId: 'tajmahal_3',
    startFrac: 0.52,
    startDir: -1,
    gateAnchors: [
      {
        ref: 'ring_nurjahan',
        shortcutViaNodeId: 'krishi_cut',
        turboZoneAfter: true,
        labelBn: 'রিং রোড দক্ষিণ মোড়',
        labelEn: 'Ring Rd West Turn',
      },
      { ref: 'nurjahan_mid', labelBn: 'নূরজাহান করিডোর', labelEn: 'Nurjahan Corridor' },
      {
        ref: 'salimullah_north',
        shortcutViaNodeId: 'salimullah_mid',
        labelBn: 'তাজমহল ল্যাপ গেট',
        labelEn: 'Tajmahal Lap Gate',
      },
    ],
    shortcuts: [
      {
        id: 'sc_krishi_07',
        nameBn: 'কৃষি মার্কেট কোনাকুনি গলি',
        nameEn: 'Krishi Market Diagonal Alley',
        fromNodeId: 'tajmahal_w',
        viaNodeId: 'krishi_cut',
        toNodeId: 'ring_nurjahan',
      },
    ],
  },

  // #6 Bazarer Badsha Halim — Town Hall -> Babar Culvert Bridge Delivery Rush
  bl_boss_06: {
    eventId: 'bl_boss_06',
    laps: 1,
    startSegmentId: 'asad_3',
    startFrac: 0.55,
    startDir: 1,
    gateAnchors: [
      {
        ref: 'shahjahan_s',
        shortcutViaNodeId: 'shershah_spur_e',
        labelBn: 'শেরশাহ-শাহজাহান মোড়',
        labelEn: 'Shahjahan Junction',
      },
      { ref: 'humayun_shahjahan', turboZoneAfter: true, labelBn: 'হুমায়ুন উত্তর মোড়', labelEn: 'Humayun North' },
      {
        ref: 'babar_humayun',
        shortcutViaNodeId: 'johuri_deadend',
        turboZoneAfter: true,
        labelBn: 'বাবর ব্রিজ ক্রেস্ট',
        labelEn: 'Babar Bridge Crest',
      },
      { ref: 'humayun_w', labelBn: 'হুমায়ুন পশ্চিম ফিনিশ', labelEn: 'Humayun West Finish' },
    ],
    shortcuts: [
      {
        id: 'sc_bazar_06',
        nameBn: 'কাঁচাবাজার শর্টকাট গলি',
        nameEn: 'Kacha Bazar Alley Cut',
        fromNodeId: 'town_hall',
        viaNodeId: 'shershah_spur_e',
        toNodeId: 'shahjahan_s',
      },
    ],
  },

  // #5 Chorabali Faisal — Multi-Shortcut Mohammadpur Labyrinth Clash
  bl_boss_05: {
    eventId: 'bl_boss_05',
    laps: 1,
    startSegmentId: 'shershah_1',
    startFrac: 0.45,
    startDir: 1,
    gateAnchors: [
      {
        ref: 'tajmahal_w',
        shortcutViaNodeId: 'aziz_gali',
        labelBn: 'তাজমহল পশ্চিম মোড়',
        labelEn: 'Tajmahal West',
      },
      {
        ref: 'ring_nurjahan',
        shortcutViaNodeId: 'krishi_cut',
        turboZoneAfter: true,
        labelBn: 'রিং রোড নূরজাহান',
        labelEn: 'Ring × Nurjahan',
      },
      { ref: 'asad_salimullah', turboZoneAfter: true, labelBn: 'আসাদ সলিমুল্লাহ মোড়', labelEn: 'Asad × Salimullah' },
      {
        ref: 'zakir_e',
        shortcutViaNodeId: 'zakir_w',
        labelBn: 'জাকির হোসেন ফিনিশ',
        labelEn: 'Zakir Hossain Finish',
      },
    ],
    shortcuts: [
      {
        id: 'sc_aziz_05',
        nameBn: 'আজিজ মহল্লা শর্টকাট',
        nameEn: 'Aziz Moholla Cut',
        fromNodeId: 'tajmahal_e',
        viaNodeId: 'aziz_gali',
        toNodeId: 'tajmahal_w',
      },
      {
        id: 'sc_lalmatia_05',
        nameBn: 'লালমাটিয়া কোনাকুনি শর্টকাট',
        nameEn: 'Lalmatia Diagonal Cut',
        fromNodeId: 'asad_salimullah',
        viaNodeId: 'zakir_w',
        toNodeId: 'zakir_e',
      },
    ],
  },

  // #4 Badol Mia — Monsoon Wet-Road Overpass & Embankment Race
  bl_boss_04: {
    eventId: 'bl_boss_04',
    laps: 1,
    startSegmentId: 'humayun_2',
    startFrac: 0.48,
    startDir: -1,
    gateAnchors: [
      { ref: 'ring_humayun', turboZoneAfter: true, labelBn: 'রিং রোড উত্তর বাঁক', labelEn: 'Ring Rd North Bend' },
      {
        ref: 'ring_nurjahan',
        shortcutViaNodeId: 'krishi_cut',
        turboZoneAfter: true,
        labelBn: 'শিয়া মসজিদ ওভারপাস স্ট্রেইট',
        labelEn: 'Shia Mosque Overpass',
      },
      { ref: 'beribadh_w', turboZoneAfter: true, labelBn: 'বেড়িবাঁধ ঢাল', labelEn: 'Beribadh Crest' },
      { ref: 'asad_salimullah', labelBn: 'আসাদ অ্যাভিনিউ ফিনিশ', labelEn: 'Asad Ave Finish' },
    ],
    shortcuts: [
      {
        id: 'sc_krishi_04',
        nameBn: 'কৃষি মার্কেট শর্টকাট',
        nameEn: 'Krishi Market Cut',
        fromNodeId: 'tajmahal_w',
        viaNodeId: 'krishi_cut',
        toNodeId: 'ring_nurjahan',
      },
    ],
  },

  // #3 Siren Sakib — Heat 3 Satmasjid Culvert Breakout
  bl_boss_03: {
    eventId: 'bl_boss_03',
    laps: 1,
    startSegmentId: 'satmasjid_2',
    startFrac: 0.62,
    startDir: -1,
    gateAnchors: [
      { ref: 'bus_stand', turboZoneAfter: true, labelBn: 'বাস স্ট্যান্ড ব্রেকআউট', labelEn: 'Bus Stand Breakout' },
      {
        ref: 'nurjahan_mid',
        shortcutViaNodeId: 'ring_south',
        labelBn: 'নূরজাহান এসকেপ করিডোর',
        labelEn: 'Nurjahan Escape',
      },
      { ref: 'salimullah_north', turboZoneAfter: true, labelBn: 'তাজমহল সেফ জোন', labelEn: 'Tajmahal Safe Zone' },
    ],
    shortcuts: [
      {
        id: 'sc_chanmia_03',
        nameBn: 'চাঁনমিয়া হাউজিং বাইপাস',
        nameEn: 'Chanmia Housing Bypass',
        fromNodeId: 'bus_stand',
        viaNodeId: 'ring_south',
        toNodeId: 'ring_nurjahan',
      },
    ],
  },

  // #2 Ring Road Ranga — Elite Turbo Boulevard & Bazar Cut Duel
  bl_boss_02: {
    eventId: 'bl_boss_02',
    laps: 1,
    startSegmentId: 'ring_4',
    startFrac: 0.62,
    startDir: -1,
    gateAnchors: [
      { ref: 'ring_tajmahal', turboZoneAfter: true, labelBn: 'শিয়া মসজিদ টার্বো জোন', labelEn: 'Shia Mosque Turbo' },
      {
        ref: 'asad_nurjahan',
        shortcutViaNodeId: 'nurjahan_mid',
        turboZoneAfter: true,
        labelBn: 'আসাদ অ্যাভিনিউ ওভারটেক স্ট্রেইট',
        labelEn: 'Asad Overtake Straight',
      },
      { ref: 'town_hall', turboZoneAfter: true, labelBn: 'টাউন হল স্পিড গেট', labelEn: 'Town Hall Speed Gate' },
      {
        ref: 'iqbal_north',
        shortcutViaNodeId: 'shershah_spur_e',
        labelBn: 'ইকবাল রোড ফিনিশ',
        labelEn: 'Iqbal Rd Finish',
      },
    ],
    shortcuts: [
      {
        id: 'sc_bazar_02',
        nameBn: 'পোস্ট অফিস কাঁচাবাজার কাট',
        nameEn: 'Post Office Market Cut',
        fromNodeId: 'town_hall',
        viaNodeId: 'shershah_spur_e',
        toNodeId: 'shahjahan_s',
      },
    ],
  },

  // #1 Asad Gate-er Samrat — 2-Lap Grand Mohammadpur Championship Circuit!
  bl_boss_01: {
    eventId: 'bl_boss_01',
    laps: 2,
    startSegmentId: 'asad_5',
    startFrac: 0.58,
    startDir: -1,
    gateAnchors: [
      { ref: 'town_hall', turboZoneAfter: true, labelBn: 'টাউন হল গ্র্যান্ড স্ট্রেইট', labelEn: 'Town Hall Straight' },
      { ref: 'bus_stand', turboZoneAfter: true, labelBn: 'বাস স্ট্যান্ড হেয়ারপিন', labelEn: 'Bus Stand Sweep' },
      {
        ref: 'tajmahal_w',
        shortcutViaNodeId: 'krishi_cut',
        labelBn: 'কৃষি মার্কেট-তাজমহল মোড়',
        labelEn: 'Tajmahal West Apex',
      },
      {
        ref: 'shahjahan_s',
        shortcutViaNodeId: 'aziz_gali',
        turboZoneAfter: true,
        labelBn: 'শাহজাহান চিকেন',
        labelEn: 'Shahjahan Chicane',
      },
      { ref: 'asad_iqbal', turboZoneAfter: true, labelBn: 'আসাদ গেট ল্যাপ আর্চ', labelEn: 'Asad Gate Lap Arch' },
    ],
    shortcuts: [
      {
        id: 'sc_krishi_01',
        nameBn: 'কৃষি মার্কেট শর্টকাট',
        nameEn: 'Krishi Market Shortcut',
        fromNodeId: 'ring_nurjahan',
        viaNodeId: 'krishi_cut',
        toNodeId: 'tajmahal_w',
      },
      {
        id: 'sc_aziz_01',
        nameBn: 'আজিজ মহল্লা শর্টকাট',
        nameEn: 'Aziz Moholla Shortcut',
        fromNodeId: 'tajmahal_w',
        viaNodeId: 'aziz_gali',
        toNodeId: 'tajmahal_e',
      },
    ],
  },

  // ---------------- 7 Repeatable Open Street Events ----------------
  // 1. Asad Avenue 2-Lap Street Circuit!
  ev_street_asad: {
    eventId: 'ev_street_asad',
    laps: 2,
    startSegmentId: 'asad_2',
    startFrac: 0.45,
    startDir: 1,
    gateAnchors: [
      { ref: 'town_hall', turboZoneAfter: true, labelBn: 'টাউন হল স্ট্রেইট', labelEn: 'Town Hall Straight' },
      {
        ref: 'shahjahan_s',
        shortcutViaNodeId: 'shershah_spur_e',
        labelBn: 'কাঁচাবাজার-শাহজাহান বাঁক',
        labelEn: 'Shahjahan Turn',
      },
      { ref: 'salimullah_mid', labelBn: 'সলিমুল্লাহ রিটার্ন', labelEn: 'Salimullah Return' },
      { ref: 'asad_salimullah', turboZoneAfter: true, labelBn: 'আসাদ অ্যাভিনিউ ল্যাপ গেট', labelEn: 'Asad Lap Gate' },
    ],
    shortcuts: [
      {
        id: 'sc_asad_bazar',
        nameBn: 'কাঁচাবাজার পেছনের গলি',
        nameEn: 'Kacha Bazar Alley Cut',
        fromNodeId: 'town_hall',
        viaNodeId: 'shershah_spur_e',
        toNodeId: 'shahjahan_s',
      },
    ],
  },

  ev_sprint_nurjahan: {
    eventId: 'ev_sprint_nurjahan',
    laps: 1,
    startSegmentId: 'nurjahan_1',
    startFrac: 0.45,
    startDir: 1,
    gateAnchors: [
      { ref: 'nurjahan_north', labelBn: 'নূরজাহান উত্তর', labelEn: 'Nurjahan North' },
      {
        ref: 'shershah_north',
        shortcutViaNodeId: 'aziz_gali',
        labelBn: 'শেরশাহ উত্তর মোড়',
        labelEn: 'Sher Shah North',
      },
      { ref: 'shershah_mid', turboZoneAfter: true, labelBn: 'শেরশাহ বাজার স্প্রিন্ট', labelEn: 'Sher Shah Sprint' },
      { ref: 'town_hall', labelBn: 'টাউন হল ফিনিশ', labelEn: 'Town Hall Finish' },
    ],
  },

  ev_delivery_bazaar: {
    eventId: 'ev_delivery_bazaar',
    laps: 1,
    startSegmentId: 'asad_3',
    startFrac: 0.55,
    startDir: 1,
    gateAnchors: [
      { ref: 'shershah_mid', labelBn: 'শেরশাহ সূরী বাজার', labelEn: 'Sher Shah Bazar' },
      {
        ref: 'tajmahal_w',
        shortcutViaNodeId: 'aziz_gali',
        labelBn: 'তাজমহল লাইব্রেরি মোড়',
        labelEn: 'Tajmahal West',
      },
      { ref: 'humayun_shahjahan', labelBn: 'হুমায়ুন ডেলিভারি ফিনিশ', labelEn: 'Humayun Finish' },
    ],
  },

  ev_shortcut_gali: {
    eventId: 'ev_shortcut_gali',
    laps: 1,
    startSegmentId: 'ring_2',
    startFrac: 0.65,
    startDir: -1,
    gateAnchors: [
      // The original first gate lay behind this south-facing grid; make the
      // forward Ring Road junction mandatory before the shortcut turns east.
      { ref: 'ring_nurjahan', labelBn: 'রিং রোড মোড়', labelEn: 'Ring Road Junction' },
      {
        ref: 'tajmahal_w',
        shortcutViaNodeId: 'krishi_cut',
        labelBn: 'তাজমহল পশ্চিম গলি',
        labelEn: 'Tajmahal West',
      },
      { ref: 'salimullah_mid', labelBn: 'সলিমুল্লাহ গলি', labelEn: 'Salimullah Mid' },
      {
        ref: 'zakir_e',
        shortcutViaNodeId: 'zakir_w',
        labelBn: 'জাকির হোসেন ফিনিশ',
        labelEn: 'Zakir Finish',
      },
    ],
    shortcuts: [
      {
        id: 'sc_gali_lalmatia',
        nameBn: 'লালমাটিয়া কোনাকুনি শর্টকাট',
        nameEn: 'Lalmatia Diagonal Cut',
        fromNodeId: 'asad_salimullah',
        viaNodeId: 'zakir_w',
        toNodeId: 'zakir_e',
      },
    ],
  },

  ev_pursuit_satmasjid: {
    eventId: 'ev_pursuit_satmasjid',
    laps: 1,
    startSegmentId: 'satmasjid_1',
    startFrac: 0.62,
    startDir: -1,
    gateAnchors: [
      { ref: 'bus_stand', turboZoneAfter: true, labelBn: 'বাস স্ট্যান্ড এস্কেপ', labelEn: 'Bus Stand Escape' },
      { ref: 'ring_tajmahal', turboZoneAfter: true, labelBn: 'শিয়া মসজিদ করিডোর', labelEn: 'Shia Mosque' },
      { ref: 'babar_mid', labelBn: 'বাবর রোড ব্রিজ সেফ জোন', labelEn: 'Babar Bridge Safe Zone' },
    ],
  },

  ev_duel_ring: {
    eventId: 'ev_duel_ring',
    laps: 1,
    startSegmentId: 'ring_3',
    startFrac: 0.55,
    startDir: -1,
    gateAnchors: [
      {
        ref: 'nurjahan_mid',
        shortcutViaNodeId: 'krishi_cut',
        turboZoneAfter: true,
        labelBn: 'নূরজাহান ক্রসিং',
        labelEn: 'Nurjahan Crossing',
      },
      { ref: 'town_hall', turboZoneAfter: true, labelBn: 'টাউন হল অ্যাভিনিউ', labelEn: 'Town Hall Avenue' },
      {
        ref: 'iqbal_north',
        shortcutViaNodeId: 'shershah_spur_e',
        labelBn: 'ইকবাল স্কুল ফিনিশ',
        labelEn: 'Iqbal School Finish',
      },
    ],
  },

  ev_survival_jam: {
    eventId: 'ev_survival_jam',
    laps: 1,
    startSegmentId: 'asad_5',
    startFrac: 0.52,
    startDir: -1,
    gateAnchors: [
      { ref: 'asad_post', turboZoneAfter: true, labelBn: 'পোস্ট অফিস স্ট্রেইট', labelEn: 'Post Office' },
      { ref: 'town_hall', turboZoneAfter: true, labelBn: 'টাউন হল জ্যাম জোন', labelEn: 'Town Hall Jam Zone' },
      { ref: 'bus_stand', labelBn: 'বাস স্ট্যান্ড মোড়', labelEn: 'Bus Stand' },
      { ref: 'satmasjid_se', labelBn: 'সাতমসজিদ ফিনিশ', labelEn: 'Satmasjid Finish' },
    ],
  },
};

function resolveAnchorCoords(ref: string): { x: number; z: number; radius: number } {
  if (ref.startsWith('place:')) {
    const pid = ref.slice('place:'.length);
    const p = placeById(pid);
    if (p) {
      const seg = segmentById(p.segmentId);
      const halfW = seg ? seg.halfWidth : 4.2;
      // Snap onto road centreline so gates sit squarely across the carriageway!
      const snap = snapToNearestRoad(p.x, p.z);
      return { x: snap.segment.ax + snap.segment.ux * (snap.segment.length * 0.5), z: snap.segment.az + snap.segment.uz * (snap.segment.length * 0.5), radius: Math.max(9.8, halfW + 4.2) };
    }
  }
  const n = nodeById(ref);
  if (n) {
    return { x: n.x, z: n.z, radius: Math.max(10.0, n.radius + 4.2) };
  }
  const p = placeById(ref);
  if (p) {
    return { x: p.x, z: p.z, radius: 10.0 };
  }
  const fallback = ROAD_SEGMENTS[0];
  return { x: fallback.ax, z: fallback.az, radius: 10.0 };
}

/**
 * Compute a collision-free staggered 2×2 starting grid for 4 rickshaws on `seg`.
 *   - `slot 0, 1, 2`: 3 distinct AI Rivals staged ahead on the grid
 *   - `slot 3`: Player rickshaw in clean sight of all 3 rivals!
 */
export function computeStartingGridOnSegment(
  seg: RoadSegment,
  frontFrac: number,
  dir: 1 | -1,
): {
  banner: { x: number; z: number; yaw: number; width: number };
  slots: [GridSlotPose, GridSlotPose, GridSlotPose, GridSlotPose];
} {
  const fx = seg.ux * dir;
  const fz = seg.uz * dir;
  const yaw = Math.atan2(fx, fz);
  // Left normal in driving direction `dir`
  const lx = seg.leftX * dir;
  const lz = seg.leftZ * dir;

  // Keep front row >= 17m from forward intersection and back row >= 11m from rear intersection
  const minFrontAlong = dir === 1 ? Math.min(seg.length * 0.52, 18.5) : Math.min(seg.length * 0.35, 13.0);
  const maxFrontAlong = dir === 1 ? Math.max(minFrontAlong, seg.length - 13.0) : Math.max(minFrontAlong, seg.length - 18.5);
  const frontAlong = clamp(frontFrac * seg.length, minFrontAlong, maxFrontAlong);

  const bannerAlong = clamp(frontAlong + dir * 2.4, 8.0, seg.length - 8.0);
  const banner = {
    x: seg.ax + seg.ux * bannerAlong,
    z: seg.az + seg.uz * bannerAlong,
    yaw,
    width: seg.width,
  };

  // Safe lateral spread that stays comfortably inside carriageway (with >= 0.9m margin to both curbs)
  const latMag = clamp(seg.halfWidth * 0.36, 0.92, 1.38);
  const rowBackOffsets = [0.0, 2.2, 4.6, 6.8];
  const latSigns = [1, -1, 1, -1]; // Alternating 2x2 staggered formation!

  const slots = [0, 1, 2, 3].map((idx) => {
    const rawAlong = frontAlong - dir * rowBackOffsets[idx];
    const safeAlong = clamp(rawAlong, Math.min(8.5, seg.length * 0.2), Math.max(seg.length - 8.5, seg.length * 0.8));
    const lat = latMag * latSigns[idx];
    const x = seg.ax + seg.ux * safeAlong + lx * lat;
    const z = seg.az + seg.uz * safeAlong + lz * lat;
    return {
      slotIndex: idx as 0 | 1 | 2 | 3,
      x,
      z,
      yaw,
    };
  }) as [GridSlotPose, GridSlotPose, GridSlotPose, GridSlotPose];

  return { banner, slots };
}

/**
 * Build a complete, graph-validated `BuiltRaceCourse` for any `RivalEventSpec`.
 */
export function buildRaceCourse(event: RivalEventSpec): BuiltRaceCourse {
  const bp = AUTHORED_COURSES[event.id];
  if (!bp) {
    return buildFallbackCourseFromPlaces(event);
  }

  const startSeg = segmentById(bp.startSegmentId) ?? ROAD_SEGMENTS[0];
  const { banner: startBanner, slots: gridSlots } = computeStartingGridOnSegment(
    startSeg,
    bp.startFrac,
    bp.startDir,
  );

  const rawGates = bp.gateAnchors.map((ga, idx) => {
    const c = resolveAnchorCoords(ga.ref);
    return {
      id: `${event.id}_g${idx}`,
      x: c.x,
      z: c.z,
      yaw: 0,
      radius: c.radius,
      shortcutViaNodeId: ga.shortcutViaNodeId,
      turboZoneAfter: ga.turboZoneAfter,
      labelBn: ga.labelBn,
      labelEn: ga.labelEn,
    } satisfies RaceGate;
  });

  // Orient each gate's forward yaw along the road heading toward the next gate!
  for (let i = 0; i < rawGates.length; i++) {
    const cur = rawGates[i];
    const next =
      i + 1 < rawGates.length
        ? rawGates[i + 1]
        : bp.laps > 1
          ? rawGates[0]
          : null;
    if (next) {
      const plan = findRoute(cur.x, cur.z, next.x, next.z);
      // findRoute includes the current node itself; skip zero-length points
      // or checkpoints at graph nodes all incorrectly face world +Z.
      const p1 = plan.points.find((p) => Math.hypot(p.x - cur.x, p.z - cur.z) > 0.5) ?? next;
      cur.yaw = Math.atan2(p1.x - cur.x, p1.z - cur.z);
    } else {
      const prev = i > 0 ? rawGates[i - 1] : { x: startBanner.x, z: startBanner.z };
      const points = findRoute(prev.x, prev.z, cur.x, cur.z).points;
      const approaching = [...points].reverse().find((p) => Math.hypot(p.x - cur.x, p.z - cur.z) > 0.5) ?? prev;
      cur.yaw = Math.atan2(cur.x - approaching.x, cur.z - approaching.z);
    }
  }

  const laps = Math.max(1, bp.laps);
  const allCheckpoints: RaceGate[] = [];
  for (let lap = 0; lap < laps; lap++) {
    for (let g = 0; g < rawGates.length; g++) {
      const base = rawGates[g];
      allCheckpoints.push({
        ...base,
        id: `${base.id}_lap${lap + 1}`,
      });
    }
  }

  const polylineLen = (pts: readonly { x: number; z: number }[]): number => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    return s;
  };

  // Compute main-line distance & documented shortcut distance savings
  let totalDistanceM = 0;
  let prevPt = { x: startBanner.x, z: startBanner.z };
  for (const cp of allCheckpoints) {
    totalDistanceM += Math.round(polylineLen(findRoute(prevPt.x, prevPt.z, cp.x, cp.z).points));
    prevPt = cp;
  }

  const shortcuts: CourseShortcutInfo[] = [];
  for (const sc of bp.shortcuts ?? []) {
    const fromN = nodeById(sc.fromNodeId);
    const viaN = nodeById(sc.viaNodeId);
    const toN = nodeById(sc.toNodeId);
    if (!fromN || !viaN || !toN) continue;
    // Main route avoiding shortcut `gali` segments vs direct route via `viaN`
    const mainPlan = findRoute(fromN.x, fromN.z, toN.x, toN.z, (segId) => {
      const seg = segmentById(segId);
      return seg && seg.kind === 'gali' ? 50.0 : 1.0;
    });
    const legA = findRoute(fromN.x, fromN.z, viaN.x, viaN.z);
    const legB = findRoute(viaN.x, viaN.z, toN.x, toN.z);
    shortcuts.push({
      id: sc.id,
      nameBn: sc.nameBn,
      nameEn: sc.nameEn,
      fromNodeId: sc.fromNodeId,
      viaNodeId: sc.viaNodeId,
      toNodeId: sc.toNodeId,
      mainDistanceM: Math.round(polylineLen(mainPlan.points)),
      shortcutDistanceM: Math.round(polylineLen(legA.points) + polylineLen(legB.points)),
    });
  }

  const lastGate = allCheckpoints[allCheckpoints.length - 1];
  const finishSnap = snapToNearestRoad(lastGate.x, lastGate.z);
  const finishBanner = {
    x: lastGate.x,
    z: lastGate.z,
    yaw: lastGate.yaw,
    width: finishSnap.segment.width,
  };

  return {
    eventId: event.id,
    laps,
    isCircuit: laps > 1,
    startSegmentId: startSeg.id,
    startDirection: bp.startDir,
    startBanner,
    finishBanner,
    gridSlots,
    lapGates: rawGates,
    allCheckpoints,
    shortcuts,
    totalDistanceM: Math.round(totalDistanceM),
  };
}

function buildFallbackCourseFromPlaces(event: RivalEventSpec): BuiltRaceCourse {
  const pts = event.waypointPlaceIds
    .map((id) => placeById(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const p0 = pts[0] ?? placeById('stand')!;
  const startSeg = segmentById(p0.segmentId) ?? ROAD_SEGMENTS[0];
  const { banner: startBanner, slots: gridSlots } = computeStartingGridOnSegment(startSeg, 0.5, 1);
  const lapGates: RaceGate[] = pts.slice(1).map((p, idx) => ({
    id: `${event.id}_fb_${idx}`,
    x: p.x,
    z: p.z,
    yaw: p.heading,
    radius: 10.0,
  }));
  if (lapGates.length === 0) {
    const bz = placeById('bazaar')!;
    lapGates.push({ id: `${event.id}_fb_0`, x: bz.x, z: bz.z, yaw: bz.heading, radius: 10.0 });
  }
  const last = lapGates[lapGates.length - 1];
  return {
    eventId: event.id,
    laps: 1,
    isCircuit: false,
    startSegmentId: startSeg.id,
    startDirection: 1,
    startBanner,
    finishBanner: { x: last.x, z: last.z, yaw: last.yaw, width: startSeg.width },
    gridSlots,
    lapGates,
    allCheckpoints: lapGates,
    shortcuts: [],
    totalDistanceM: 250,
  };
}

export interface AiWaypoint {
  x: number;
  z: number;
  /** Index in `course.allCheckpoints` that this waypoint is heading toward. */
  targetGateIndex: number;
  isTurboStraight: boolean;
  /** Launch corridor waypoint: do not cut the junction before reaching it. */
  isLaunch?: boolean;
}

/**
 * Build a complete drivable road waypoint chain for an AI opponent according
 * to its racing tendency (`clean_line`, `aggressive_overtaker`, or `shortcut_seeker`).
 */
export function buildAiWaypointsForTendency(
  course: BuiltRaceCourse,
  startPose: GridSlotPose,
  tendency: AiRacingTendency,
): AiWaypoint[] {
  const waypoints: AiWaypoint[] = [];
  let curX = startPose.x;
  let curZ = startPose.z;
  let turboNext = false;
  let firstLeg = true;
  const startSegment = segmentById(course.startSegmentId);

  const pushLeg = (toX: number, toZ: number, gateIdx: number, preferMainAvenues: boolean): void => {
    // findRoute starts at the *nearest node*, which may be behind the grid.
    // First follow the authored corridor to its forward junction, then plan
    // from that node. Discourage an immediate U-turn over the same corridor;
    // the edge remains available if the graph has no alternative.
    let avoidStartSegment = false;
    if (firstLeg && startSegment) {
      firstLeg = false;
      const dir = course.startDirection;
      const alongStart = (curX - startSegment.ax) * startSegment.ux + (curZ - startSegment.az) * startSegment.uz;
      const alongTarget = (toX - startSegment.ax) * startSegment.ux + (toZ - startSegment.az) * startSegment.uz;
      const lateralTarget = Math.abs((toX - startSegment.ax) * startSegment.leftX + (toZ - startSegment.az) * startSegment.leftZ);
      const targetAheadOnCorridor = lateralTarget <= 1.5 && alongTarget >= 0 && alongTarget <= startSegment.length &&
        (alongTarget - alongStart) * dir > 1;
      if (targetAheadOnCorridor) {
        waypoints.push({ x: toX, z: toZ, targetGateIndex: gateIdx, isTurboStraight: false, isLaunch: true });
        curX = toX;
        curZ = toZ;
        return;
      }
      const exit = dir === 1
        ? { x: startSegment.bx, z: startSegment.bz }
        : { x: startSegment.ax, z: startSegment.az };
      waypoints.push({ ...exit, targetGateIndex: gateIdx, isTurboStraight: false, isLaunch: true });
      curX = exit.x;
      curZ = exit.z;
      avoidStartSegment = true;
    }
    // Both endpoints may lie on the *same* graph edge (not at its nodes).
    // A nearest-node A* detour can otherwise run all the way to the far
    // junction, then double back to a mid-block finish. Stay on that open
    // carriageway instead; preserve the authored forward launch above.
    const sharedEdge = ROAD_SEGMENTS.find((seg) => {
      const onEdge = (x: number, z: number): boolean => {
        const along = (x - seg.ax) * seg.ux + (z - seg.az) * seg.uz;
        const lateral = Math.abs((x - seg.ax) * seg.leftX + (z - seg.az) * seg.leftZ);
        return along >= -0.2 && along <= seg.length + 0.2 && lateral <= seg.halfWidth - 0.35;
      };
      return onEdge(curX, curZ) && onEdge(toX, toZ);
    });
    if (sharedEdge) {
      waypoints.push({ x: toX, z: toZ, targetGateIndex: gateIdx, isTurboStraight: turboNext });
      curX = toX;
      curZ = toZ;
      return;
    }
    const plan = findRoute(
      curX,
      curZ,
      toX,
      toZ,
      (segId) => {
        const s = segmentById(segId);
        const mainPenalty = preferMainAvenues && s?.kind === 'gali' ? 1.45 : 1.0;
        return avoidStartSegment && segId === startSegment?.id ? 1000 : mainPenalty;
      },
    );
    for (let i = 1; i < plan.points.length; i++) {
      const pt = plan.points[i];
      if (
        waypoints.length > 0 &&
        Math.hypot(pt.x - waypoints[waypoints.length - 1].x, pt.z - waypoints[waypoints.length - 1].z) < 2.2
      ) {
        continue;
      }
      waypoints.push({
        x: pt.x,
        z: pt.z,
        targetGateIndex: gateIdx,
        isTurboStraight: turboNext,
      });
    }
    curX = toX;
    curZ = toZ;
  };

  for (let gIdx = 0; gIdx < course.allCheckpoints.length; gIdx++) {
    const gate = course.allCheckpoints[gIdx];
    const viaNode =
      tendency === 'shortcut_seeker' && gate.shortcutViaNodeId
        ? nodeById(gate.shortcutViaNodeId)
        : undefined;
    if (viaNode) {
      pushLeg(viaNode.x, viaNode.z, gIdx, false);
      pushLeg(gate.x, gate.z, gIdx, false);
    } else {
      pushLeg(gate.x, gate.z, gIdx, tendency === 'clean_line');
    }
    turboNext = Boolean(gate.turboZoneAfter);
  }

  return waypoints;
}

export interface CourseValidationReport {
  eventId: string;
  valid: boolean;
  issues: string[];
  gridSlotsOnRoad: boolean;
  minSlotSpacingM: number;
  gatesOnRoad: boolean;
  checkpointCount: number;
  laps: number;
  totalDistanceM: number;
}

/** Pure deterministic course validator for automated unit & E2E verification. */
export function validateRaceCourse(event: RivalEventSpec): CourseValidationReport {
  const course = buildRaceCourse(event);
  const issues: string[] = [];

  let gridSlotsOnRoad = true;
  for (const slot of course.gridSlots) {
    const dRoad = distanceToRoadCarriageway(slot.x, slot.z);
    if (dRoad > 0.05) {
      gridSlotsOnRoad = false;
      issues.push(`grid slot ${slot.slotIndex} outside carriageway by ${dRoad.toFixed(2)}m`);
    }
  }

  let minSlotSpacingM = Infinity;
  for (let i = 0; i < course.gridSlots.length; i++) {
    for (let j = i + 1; j < course.gridSlots.length; j++) {
      const a = course.gridSlots[i];
      const b = course.gridSlots[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < minSlotSpacingM) minSlotSpacingM = d;
    }
  }
  if (minSlotSpacingM < 2.2) {
    issues.push(`grid slots too close (${minSlotSpacingM.toFixed(2)}m < 2.2m)`);
  }

  let gatesOnRoad = true;
  for (const gate of course.allCheckpoints) {
    const dRoad = distanceToRoadCarriageway(gate.x, gate.z);
    if (dRoad > 1.2) {
      gatesOnRoad = false;
      issues.push(`gate ${gate.id} off road (${dRoad.toFixed(2)}m)`);
    }
  }

  for (const t of ['clean_line', 'aggressive_overtaker', 'shortcut_seeker'] as const) {
    const wps = buildAiWaypointsForTendency(course, course.gridSlots[0], t);
    if (wps.length < course.allCheckpoints.length) {
      issues.push(`tendency ${t} produced insufficient waypoints (${wps.length})`);
    }
  }

  return {
    eventId: event.id,
    valid: issues.length === 0,
    issues,
    gridSlotsOnRoad,
    minSlotSpacingM: Number(minSlotSpacingM.toFixed(2)),
    gatesOnRoad,
    checkpointCount: course.allCheckpoints.length,
    laps: course.laps,
    totalDistanceM: course.totalDistanceM,
  };
}
