/**
 * Original `রিকশা ব্ল্যাকলিস্ট` (#10 -> #1) Rivals & 7 Rival Event Types (v0.5.0).
 *
 * 100% original Bangladeshi characters, custom rickshaw liveries, Mohammadpur
 * territories, and progression data. Zero copied proprietary names or assets.
 */

import type { WeatherKind } from '../core/config';
import type { DriverCharacterSpec, RickshawLook } from '../vehicle/rickshawModel';
import type { AiRacingTendency } from './raceRoutes';

export type RivalEventKind =
  | 'street_race'
  | 'checkpoint_sprint'
  | 'delivery_rush'
  | 'shortcut_challenge'
  | 'pursuit_escape'
  | 'rival_duel'
  | 'traffic_survival';

export const ALL_RIVAL_EVENT_KINDS: readonly RivalEventKind[] = [
  'street_race',
  'checkpoint_sprint',
  'delivery_rush',
  'shortcut_challenge',
  'pursuit_escape',
  'rival_duel',
  'traffic_survival',
];

export interface RivalEventSpec {
  id: string;
  kind: RivalEventKind;
  titleBn: string;
  titleEn: string;
  descBn: string;
  descEn: string;
  /** Ordered `PLACES` landmark IDs forming start -> intermediate checkpoints -> finish. */
  waypointPlaceIds: string[];
  targetSeconds: number;
  cashReward: number;
  repReward: number;
  lossFee: number;
  rivalBaseSpeed: number; // m/s
  weatherOverride?: WeatherKind;
  heatLevel?: number;
  roadblockCount?: number;
  /** Optional Blacklist boss rank (10..1) if this event is a Blacklist rank match. */
  blacklistRank?: number;
}

export interface BlacklistRival {
  rank: number; // 10 down to 1
  id: string;
  nameBn: string;
  nameEn: string;
  archetypeBn: string;
  archetypeEn: string;
  territoryBn: string;
  territoryEn: string;
  tauntBn: string;
  tauntEn: string;
  repRequired: number;
  accentHex: string;
  tendency: AiRacingTendency;
  character: DriverCharacterSpec;
  look: RickshawLook;
  bossEvent: RivalEventSpec;
}

const CHAR_10_RAJU: DriverCharacterSpec = {
  skinHex: '#8d5b3c',
  hairStyle: 'bandana',
  hairHex: '#18181b',
  headwearHex: '#d97706',
  eyewear: 'none',
  expression: 'grin',
  outfitStyle: 'vest_lungi',
  topHex: '#146c54',
  bottomHex: '#7c2d12',
  accentHex: '#2ec4b6',
};

const CHAR_09_SUMON: DriverCharacterSpec = {
  skinHex: '#9c6644',
  hairStyle: 'peaked_cap',
  hairHex: '#1e1b18',
  headwearHex: '#1d4ed8',
  eyewear: 'none',
  expression: 'determined',
  outfitStyle: 'kurta_gamcha',
  topHex: '#b91c1c',
  bottomHex: '#1e3a8a',
  accentHex: '#f59e0b',
};

const CHAR_08_TAREK: DriverCharacterSpec = {
  skinHex: '#7f4f32',
  hairStyle: 'spiky',
  hairHex: '#1c1917',
  headwearHex: '#fb923c',
  eyewear: 'none',
  expression: 'fierce',
  outfitStyle: 'jersey_track',
  topHex: '#ea580c',
  bottomHex: '#1c1917',
  accentHex: '#fde047',
};

const CHAR_07_NABILA: DriverCharacterSpec = {
  skinHex: '#a47148',
  hairStyle: 'ponytail_bun',
  hairHex: '#0f172a',
  headwearHex: '#22d3ee',
  eyewear: 'sport_visor',
  expression: 'cool',
  outfitStyle: 'jacket_pants',
  topHex: '#0e7490',
  bottomHex: '#1e293b',
  accentHex: '#38bdf8',
};

const CHAR_06_HALIM: DriverCharacterSpec = {
  skinHex: '#73482d',
  hairStyle: 'pagri_wrap',
  hairHex: '#1f2937',
  headwearHex: '#b91c1c',
  eyewear: 'none',
  expression: 'grin',
  outfitStyle: 'kurta_gamcha',
  topHex: '#15803d',
  bottomHex: '#365314',
  accentHex: '#facc15',
};

const CHAR_05_FAISAL: DriverCharacterSpec = {
  skinHex: '#935f3e',
  hairStyle: 'bucket_hat',
  hairHex: '#18181b',
  headwearHex: '#312e81',
  eyewear: 'none',
  expression: 'determined',
  outfitStyle: 'jacket_pants',
  topHex: '#4338ca',
  bottomHex: '#1e1b4b',
  accentHex: '#818cf8',
};

const CHAR_04_BADOL: DriverCharacterSpec = {
  skinHex: '#855336',
  hairStyle: 'peaked_cap',
  hairHex: '#111827',
  headwearHex: '#0284c7',
  eyewear: 'none',
  expression: 'cool',
  outfitStyle: 'raincoat',
  topHex: '#0369a1',
  bottomHex: '#1e293b',
  accentHex: '#bae6fd',
};

const CHAR_03_SAKIB: DriverCharacterSpec = {
  skinHex: '#8b5a3c',
  hairStyle: 'headband',
  hairHex: '#09090b',
  headwearHex: '#dc2626',
  eyewear: 'aviator',
  expression: 'fierce',
  outfitStyle: 'jacket_pants',
  topHex: '#18181b',
  bottomHex: '#27272a',
  accentHex: '#f43f5e',
};

const CHAR_02_RANGA: DriverCharacterSpec = {
  skinHex: '#9a6544',
  hairStyle: 'curly',
  hairHex: '#18181b',
  headwearHex: '#be123c',
  eyewear: 'sport_visor',
  expression: 'fierce',
  outfitStyle: 'jersey_track',
  topHex: '#86198f',
  bottomHex: '#3b0764',
  accentHex: '#facc15',
};

const CHAR_01_SAMRAT: DriverCharacterSpec = {
  skinHex: '#7c4d30',
  hairStyle: 'crown_bandana',
  hairHex: '#09090b',
  headwearHex: '#991b1b',
  eyewear: 'aviator',
  expression: 'fierce',
  outfitStyle: 'royal_sherwani',
  topHex: '#064e3b',
  bottomHex: '#022c22',
  accentHex: '#facc15',
};

export const BLACKLIST_RIVALS: readonly BlacklistRival[] = [
  {
    rank: 10,
    id: 'bl_10_raju',
    nameBn: 'কানা গলির রাজু',
    nameEn: 'Kana Galir Raju',
    archetypeBn: 'অ্যালি স্পেশালিস্ট',
    archetypeEn: 'Alley Specialist',
    territoryBn: 'জাকির হোসেন রোড ও নূরজাহান গলি',
    territoryEn: 'Zakir Hossain Rd & Nurjahan Lanes',
    tauntBn: 'চিকন গলিতে আমার চাকা বাতাসের আগে ঘোরে! পারলে আমার পিছে আয়!',
    tauntEn: 'My wheels cut narrow lanes faster than the wind! Try keeping up!',
    repRequired: 0,
    accentHex: '#2ec4b6',
    tendency: 'shortcut_seeker',
    character: CHAR_10_RAJU,
    look: {
      frameColor: '#146c54',
      canopyColor: '#d97706',
      canopyTrim: '#fde047',
      wheelTrim: '#fef08a',
      artMotif: 'lotus',
      artPrimary: '#0f5132',
      artSecondary: '#facc15',
      fairyLights: false,
      bellUpgrade: true,
      bell: 'brass',
      mirrorSet: true,
      flowersColor: '#f59e0b',
      kind: 'pedal',
      character: CHAR_10_RAJU,
    },
    bossEvent: {
      id: 'bl_boss_10',
      kind: 'shortcut_challenge',
      titleBn: 'ব্ল্যাকলিস্ট #১০ — গলির টেক্কা',
      titleEn: 'Blacklist #10 — Alley Showdown',
      descBn: 'জাকির হোসেন রোড থেকে তাজমহল রোড হয়ে নূরজাহান চায়ের মোড়ে রাজুকে হারান।',
      descEn: 'Outrun Raju from Zakir Hossain Rd through Tajmahal lanes to Nurjahan Corner.',
      waypointPlaceIds: ['zakir', 'salimullah', 'tea'],
      targetSeconds: 115,
      cashReward: 260,
      repReward: 120,
      lossFee: 25,
      rivalBaseSpeed: 6.2,
      blacklistRank: 10,
    },
  },
  {
    rank: 9,
    id: 'bl_09_sumon',
    nameBn: 'ঘণ্টা সুমন',
    nameEn: 'Ghonta Sumon',
    archetypeBn: 'ট্রাফিক স্পেশালিস্ট',
    archetypeEn: 'Traffic Specialist',
    territoryBn: 'নূরজাহান রোড ও বাস স্ট্যান্ড',
    territoryEn: 'Nurjahan Rd & Bus Stand',
    tauntBn: 'জ্যামের ভেতর ঘণ্টা বাজিয়েই আমি গায়েব! তোর রিকশা জ্যামেই আটকে থাকবে!',
    tauntEn: 'One ring of my brass bell and I vanish through the jam! Eat my dust!',
    repRequired: 100,
    accentHex: '#f59e0b',
    tendency: 'clean_line',
    character: CHAR_09_SUMON,
    look: {
      frameColor: '#9b1c2c',
      canopyColor: '#1d4ed8',
      canopyTrim: '#fbbf24',
      wheelTrim: '#fde68a',
      artMotif: 'peacock',
      artPrimary: '#7f1d1d',
      artSecondary: '#fbbf24',
      fairyLights: false,
      bellUpgrade: true,
      bell: 'double',
      mirrorSet: true,
      flowersColor: '#ef4444',
      kind: 'pedal',
      character: CHAR_09_SUMON,
    },
    bossEvent: {
      id: 'bl_boss_09',
      kind: 'traffic_survival',
      titleBn: 'ব্ল্যাকলিস্ট #৯ — জ্যাম চিরে দৌড়',
      titleEn: 'Blacklist #9 — Congestion Threader',
      descBn: 'বাস স্ট্যান্ডের ভিড় চিরে টাউন হল কাঁচাবাজার হয়ে শের শাহ সূরি রোডে পৌঁছান।',
      descEn: 'Thread dense Bus Stand & Town Hall traffic cleanly ahead of Sumon.',
      waypointPlaceIds: ['stand', 'bazaar', 'garage'],
      targetSeconds: 88,
      cashReward: 320,
      repReward: 150,
      lossFee: 30,
      rivalBaseSpeed: 6.6,
      blacklistRank: 9,
    },
  },
  {
    rank: 8,
    id: 'bl_08_tarek',
    nameBn: 'বিজলি তারেক',
    nameEn: 'Bijli Tarek',
    archetypeBn: 'অ্যাক্সেলারেশন স্পেশালিস্ট',
    archetypeEn: 'Acceleration Specialist',
    territoryBn: 'সলিমুল্লাহ রোড ও ইকবাল রোড',
    territoryEn: 'Salimullah Rd & Iqbal Rd',
    tauntBn: 'সিগন্যাল সবুজ হওয়ার আগেই আমার টান শুরু হয়!',
    tauntEn: 'My launch hits top speed before the signal even turns green!',
    repRequired: 240,
    accentHex: '#fb923c',
    tendency: 'aggressive_overtaker',
    character: CHAR_08_TAREK,
    look: {
      frameColor: '#c2410c',
      canopyColor: '#15803d',
      canopyTrim: '#fde047',
      wheelTrim: '#fed7aa',
      artMotif: 'tiger',
      artPrimary: '#9a3412',
      artSecondary: '#facc15',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'brass',
      mirrorSet: true,
      flowersColor: '#fb923c',
      kind: 'pedal',
      character: CHAR_08_TAREK,
    },
    bossEvent: {
      id: 'bl_boss_08',
      kind: 'checkpoint_sprint',
      titleBn: 'ব্ল্যাকলিস্ট #৮ — বিজলি চেকপয়েন্ট স্প্রিন্ট',
      titleEn: 'Blacklist #8 — Bijli Checkpoint Sprint',
      descBn: 'সলিমুল্লাহ রোড থেকে স্কুল মোড় ও পোস্ট অফিস হয়ে দ্রুত স্প্রিন্ট জিতুন।',
      descEn: 'Beat Tarek across high-speed checkpoints from Salimullah Rd to Post Office.',
      waypointPlaceIds: ['salimullah', 'bazaar', 'school', 'pharmacy'],
      targetSeconds: 115,
      cashReward: 390,
      repReward: 185,
      lossFee: 32,
      rivalBaseSpeed: 7.0,
      blacklistRank: 8,
    },
  },
  {
    rank: 7,
    id: 'bl_07_nabila',
    nameBn: 'কারেন্ট নাবিলা',
    nameEn: 'Current Nabila',
    archetypeBn: 'ইলেকট্রিক রিকশা স্পেশালিস্ট',
    archetypeEn: 'Electric-Rickshaw Specialist',
    territoryBn: 'তাজমহল রোড ও রিং রোড',
    territoryEn: 'Tajmahal Rd & Ring Rd',
    tauntBn: '৪৮ ভোল্টের টর্কে তোর প্যাডেল কোনো পাত্তাই পাবে না!',
    tauntEn: 'My 48-volt torque leaves old-school pedals way behind!',
    repRequired: 410,
    accentHex: '#38bdf8',
    tendency: 'clean_line',
    character: CHAR_07_NABILA,
    look: {
      frameColor: '#0e7490',
      canopyColor: '#1e293b',
      canopyTrim: '#22d3ee',
      wheelTrim: '#67e8f9',
      artMotif: 'cinema',
      artPrimary: '#155e75',
      artSecondary: '#38bdf8',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'double',
      mirrorSet: true,
      flowersColor: '#38bdf8',
      kind: 'electric',
      character: CHAR_07_NABILA,
    },
    bossEvent: {
      id: 'bl_boss_07',
      kind: 'street_race',
      titleBn: 'ব্ল্যাকলিস্ট #৭ — হাই-ভোল্টেজ সার্কিট রেস',
      titleEn: 'Blacklist #7 — High-Voltage 2-Lap Circuit',
      descBn: 'তাজমহল রোড, শিয়া মসজিদ ও নূরজাহান জুড়ে ২-ল্যাপ সার্কিটে নাবিলাকে হারান।',
      descEn: 'Race Nabila across a 2-lap Tajmahal, Shia Mosque & Nurjahan circuit.',
      waypointPlaceIds: ['library', 'mosque', 'market', 'humayun'],
      targetSeconds: 180,
      cashReward: 460,
      repReward: 220,
      lossFee: 35,
      rivalBaseSpeed: 7.4,
      roadblockCount: 1,
      blacklistRank: 7,
    },
  },
  {
    rank: 6,
    id: 'bl_06_halim',
    nameBn: 'বাজারের বাদশা হালিম',
    nameEn: 'Bazarer Badsha Halim',
    archetypeBn: 'ডেলিভারি স্পেশালিস্ট',
    archetypeEn: 'Delivery Specialist',
    territoryBn: 'টাউন হল কাঁচাবাজার ও বাবর রোড',
    territoryEn: 'Town Hall Kacha Bazar & Babar Rd',
    tauntBn: 'টাউন হলের ভিড় আমার হাতের তালুর মতো চেনা! সময় শেষ হওয়ার আগে পারবি?',
    tauntEn: 'I know Town Hall Bazar like the back of my hand! Beat my delivery clock!',
    repRequired: 610,
    accentHex: '#a3e635',
    tendency: 'clean_line',
    character: CHAR_06_HALIM,
    look: {
      frameColor: '#15803d',
      canopyColor: '#b91c1c',
      canopyTrim: '#facc15',
      wheelTrim: '#bef264',
      artMotif: 'lotus',
      artPrimary: '#166534',
      artSecondary: '#fde047',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'brass',
      mirrorSet: true,
      flowersColor: '#facc15',
      kind: 'pedal',
      character: CHAR_06_HALIM,
    },
    bossEvent: {
      id: 'bl_boss_06',
      kind: 'delivery_rush',
      titleBn: 'ব্ল্যাকলিস্ট #৬ — কাঁচাবাজার ডেলিভারি রাশ',
      titleEn: 'Blacklist #6 — Bazaar Delivery Rush',
      descBn: 'টাউন হল থেকে বাবর রোড ব্রিজ হয়ে হুমায়ুন রোডে দ্রুত ডেলিভারি সম্পন্ন করুন।',
      descEn: 'Outpace Halim on an urgent Town Hall to Babar Rd & Humayun Rd rush.',
      waypointPlaceIds: ['bazaar', 'garage', 'humayun', 'bridge'],
      targetSeconds: 145,
      cashReward: 540,
      repReward: 260,
      lossFee: 38,
      rivalBaseSpeed: 7.7,
      roadblockCount: 1,
      blacklistRank: 6,
    },
  },
  {
    rank: 5,
    id: 'bl_05_faisal',
    nameBn: 'চোরাবালি ফয়সাল',
    nameEn: 'Chorabali Faisal',
    archetypeBn: 'শর্টকাট এক্সপার্ট',
    archetypeEn: 'Shortcut Expert',
    territoryBn: 'শের শাহ সূরি ও শাহজাহান রোড',
    territoryEn: 'Sher Shah Suri & Shahjahan Rd',
    tauntBn: 'সোজা রাস্তায় সবাই চালায়, আসল খেলা তো চোরাবালি শর্টকাটে!',
    tauntEn: 'Anyone can ride main avenues — real legends own the hidden shortcuts!',
    repRequired: 850,
    accentHex: '#818cf8',
    tendency: 'shortcut_seeker',
    character: CHAR_05_FAISAL,
    look: {
      frameColor: '#1e3a8a',
      canopyColor: '#6d28d9',
      canopyTrim: '#c7d2fe',
      wheelTrim: '#a5b4fc',
      artMotif: 'peacock',
      artPrimary: '#312e81',
      artSecondary: '#a5b4fc',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'double',
      mirrorSet: true,
      flowersColor: '#818cf8',
      kind: 'pedal',
      character: CHAR_05_FAISAL,
    },
    bossEvent: {
      id: 'bl_boss_05',
      kind: 'shortcut_challenge',
      titleBn: 'ব্ল্যাকলিস্ট #৫ — চোরাবালি শর্টকাট দ্বন্দ্ব',
      titleEn: 'Blacklist #5 — Chorabali Shortcut Clash',
      descBn: 'শের শাহ সূরি রোড থেকে তাজমহল ও জাকির হোসেন রোডের শর্টকাট ধরে জিতুন।',
      descEn: 'Use Mohammadpur cross-lanes to beat Faisal to Zakir Hossain Rd.',
      waypointPlaceIds: ['garage', 'library', 'tea', 'zakir'],
      targetSeconds: 140,
      cashReward: 640,
      repReward: 310,
      lossFee: 42,
      rivalBaseSpeed: 8.1,
      roadblockCount: 2,
      blacklistRank: 5,
    },
  },
  {
    rank: 4,
    id: 'bl_04_badol',
    nameBn: 'বাদল মিয়া',
    nameEn: 'Badol Mia',
    archetypeBn: 'বর্ষা ও ভেজা রাস্তার ওস্তাদ',
    archetypeEn: 'Monsoon Rain Specialist',
    territoryBn: 'হুমায়ুন রোড ও বাবর রোড',
    territoryEn: 'Humayun Rd & Babar Rd',
    tauntBn: 'ঝুম বৃষ্টিতে যখন সবার ব্রেক পিছলায়, তখন বাদল মিয়ার রিকশা ওড়ে!',
    tauntEn: 'When monsoon rain makes everyone slip, Badol Mia flies through corners!',
    repRequired: 1140,
    accentHex: '#60a5fa',
    tendency: 'clean_line',
    character: CHAR_04_BADOL,
    look: {
      frameColor: '#3b0764',
      canopyColor: '#0284c7',
      canopyTrim: '#bae6fd',
      wheelTrim: '#93c5fd',
      artMotif: 'lotus',
      artPrimary: '#1e1b4b',
      artSecondary: '#38bdf8',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'brass',
      mirrorSet: true,
      flowersColor: '#60a5fa',
      kind: 'electric',
      character: CHAR_04_BADOL,
    },
    bossEvent: {
      id: 'bl_boss_04',
      kind: 'street_race',
      titleBn: 'ব্ল্যাকলিস্ট #৪ — শ্রাবণ ঝড় স্ট্রিট রেস',
      titleEn: 'Blacklist #4 — Monsoon Storm Street Race',
      descBn: 'ভেজা রাস্তায় হুমায়ুন রোড থেকে শিয়া মসজিদ হয়ে আসাদ অ্যাভিনিউ পর্যন্ত রেস!',
      descEn: 'Master wet braking from Humayun Rd past Shia Mosque to Asad Avenue!',
      waypointPlaceIds: ['humayun', 'market', 'mosque', 'stand'],
      targetSeconds: 105,
      cashReward: 760,
      repReward: 360,
      lossFee: 45,
      rivalBaseSpeed: 8.4,
      weatherOverride: 'rain',
      roadblockCount: 2,
      blacklistRank: 4,
    },
  },
  {
    rank: 3,
    id: 'bl_03_sakib',
    nameBn: 'সাইরেন সাকিব',
    nameEn: 'Siren Sakib',
    archetypeBn: 'পুলিশ পারস্যুট স্পেশালিস্ট',
    archetypeEn: 'Pursuit Specialist',
    territoryBn: 'সাতমসজিদ রোড ও বাস স্ট্যান্ড',
    territoryEn: 'Satmasjid Rd & Bus Stand',
    tauntBn: 'পুলিশের সাইরেন শুনলেই তোর হাত কাঁপে, আর আমার টার্বো জ্বলে ওঠে!',
    tauntEn: 'Police sirens make your hands shake — they just wake my Turbo up!',
    repRequired: 1480,
    accentHex: '#f43f5e',
    tendency: 'aggressive_overtaker',
    character: CHAR_03_SAKIB,
    look: {
      frameColor: '#18181b',
      canopyColor: '#dc2626',
      canopyTrim: '#facc15',
      wheelTrim: '#f87171',
      artMotif: 'tiger',
      artPrimary: '#09090b',
      artSecondary: '#ef4444',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'double',
      mirrorSet: true,
      flowersColor: '#f43f5e',
      kind: 'electric',
      character: CHAR_03_SAKIB,
    },
    bossEvent: {
      id: 'bl_boss_03',
      kind: 'pursuit_escape',
      titleBn: 'ব্ল্যাকলিস্ট #৩ — হিট ৩ সাইরেন ব্রেকআউট',
      titleEn: 'Blacklist #3 — Heat 3 Siren Breakout',
      descBn: 'সাতমসজিদ রোড থেকে পুলিশ ব্যারিকেড ভেঙে সাকিবের আগে সেফ পয়েন্টে পৌঁছান!',
      descEn: 'Smash past Heat 3 police roadblocks from Satmasjid Rd and beat Sakib!',
      waypointPlaceIds: ['launch', 'stand', 'tea', 'library'],
      targetSeconds: 105,
      cashReward: 920,
      repReward: 430,
      lossFee: 50,
      rivalBaseSpeed: 8.8,
      heatLevel: 3,
      roadblockCount: 3,
      blacklistRank: 3,
    },
  },
  {
    rank: 2,
    id: 'bl_02_ranga',
    nameBn: 'রিং রোড রাঙা',
    nameEn: 'Ring Road Ranga',
    archetypeBn: 'এলিট স্পিড রাইভাল',
    archetypeEn: 'Elite Speed Rival',
    territoryBn: 'রিং রোড ও শিয়া মসজিদ করিডোর',
    territoryEn: 'Ring Rd & Shia Mosque Corridor',
    tauntBn: 'রিং রোডে আমার টার্বোর আগুনের সামনে কেউ টিকে থাকতে পারেনি!',
    tauntEn: 'Nobody has ever survived my Turbo flames down the Ring Road straight!',
    repRequired: 1900,
    accentHex: '#ec4899',
    tendency: 'aggressive_overtaker',
    character: CHAR_02_RANGA,
    look: {
      frameColor: '#701a75',
      canopyColor: '#be123c',
      canopyTrim: '#fde047',
      wheelTrim: '#f472b6',
      artMotif: 'cinema',
      artPrimary: '#4a044e',
      artSecondary: '#facc15',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'double',
      mirrorSet: true,
      flowersColor: '#ec4899',
      kind: 'electric',
      character: CHAR_02_RANGA,
    },
    bossEvent: {
      id: 'bl_boss_02',
      kind: 'rival_duel',
      titleBn: 'ব্ল্যাকলিস্ট #২ — রিং রোড ফায়ার ডুয়েল',
      titleEn: 'Blacklist #2 — Ring Road Fire Duel',
      descBn: 'রিং রোড থেকে টাউন হল ও ইকবাল রোড হয়ে রাঙার সাথে হাই-স্পিড ডুয়েল!',
      descEn: 'High-speed Turbo duel against Ranga across Ring Rd, Town Hall & Iqbal Rd!',
      waypointPlaceIds: ['market', 'mosque', 'bazaar', 'school'],
      targetSeconds: 105,
      cashReward: 1150,
      repReward: 520,
      lossFee: 55,
      rivalBaseSpeed: 9.2,
      heatLevel: 3,
      roadblockCount: 3,
      blacklistRank: 2,
    },
  },
  {
    rank: 1,
    id: 'bl_01_samrat',
    nameBn: 'আসাদ গেটের সম্রাট',
    nameEn: 'Asad Gate-er Samrat',
    archetypeBn: 'ব্ল্যাকলিস্ট #১ চ্যাম্পিয়ন',
    archetypeEn: 'Blacklist #1 Final Champion',
    territoryBn: 'আসাদ অ্যাভিনিউ গ্র্যান্ড সার্কিট',
    territoryEn: 'Asad Avenue Grand Circuit',
    tauntBn: 'মোহাম্মদপুরের রাস্তা আজ আমার দখলে! পারলে ধরে দেখা, নতুন ওস্তাদ!',
    tauntEn: "Mohammadpur's streets belong to me tonight! Catch me if you can, challenger!",
    repRequired: 2400,
    accentHex: '#facc15',
    tendency: 'aggressive_overtaker',
    character: CHAR_01_SAMRAT,
    look: {
      frameColor: '#064e3b',
      canopyColor: '#991b1b',
      canopyTrim: '#facc15',
      wheelTrim: '#fde047',
      artMotif: 'tiger',
      artPrimary: '#022c22',
      artSecondary: '#facc15',
      fairyLights: true,
      bellUpgrade: true,
      bell: 'double',
      mirrorSet: true,
      flowersColor: '#facc15',
      kind: 'electric',
      character: CHAR_01_SAMRAT,
    },
    bossEvent: {
      id: 'bl_boss_01',
      kind: 'rival_duel',
      titleBn: 'ব্ল্যাকলিস্ট #১ — আসাদ গেট গ্র্যান্ড সার্কিট',
      titleEn: 'Blacklist #1 — Asad Gate 2-Lap Grand Finale',
      descBn: 'পুরো মোহাম্মদপুর জুড়ে ২-ল্যাপ গ্র্যান্ড সার্কিটে সম্রাটকে হারিয়ে #১ মুকুট জিতুন!',
      descEn: 'Defeat Samrat across the 2-lap Mohammadpur Grand Circuit to claim the #1 Crown!',
      waypointPlaceIds: ['pharmacy', 'bazaar', 'stand', 'launch', 'mosque', 'bridge', 'pharmacy'],
      targetSeconds: 270,
      cashReward: 2000,
      repReward: 900,
      lossFee: 60,
      rivalBaseSpeed: 9.6,
      heatLevel: 4,
      roadblockCount: 4,
      blacklistRank: 1,
    },
  },
];

/**
 * 7 Always-Playable Repeatable Street Events (one per required event type) so
 * the player can earn টাকা & REP anytime and is never progression-locked!
 */
export const OPEN_STREET_EVENTS: readonly RivalEventSpec[] = [
  {
    id: 'ev_street_asad',
    kind: 'street_race',
    titleBn: 'আসাদ অ্যাভিনিউ ২-ল্যাপ সার্কিট',
    titleEn: 'Asad Avenue 2-Lap Street Circuit',
    descBn: 'আসাদ অ্যাভিনিউ, টাউন হল ও সলিমুল্লাহ রোড ঘিরে ৪ রিকশার ২-ল্যাপ স্ট্রিট সার্কিট।',
    descEn: 'Four-rickshaw 2-lap street circuit around Asad Ave, Town Hall & Salimullah Rd.',
    waypointPlaceIds: ['stand', 'bazaar', 'pharmacy'],
    targetSeconds: 245,
    cashReward: 160,
    repReward: 85,
    lossFee: 20,
    rivalBaseSpeed: 6.1,
  },
  {
    id: 'ev_sprint_nurjahan',
    kind: 'checkpoint_sprint',
    titleBn: 'নূরজাহান চেকপয়েন্ট স্প্রিন্ট',
    titleEn: 'Nurjahan Checkpoint Sprint',
    descBn: 'সময় শেষ হওয়ার আগে নূরজাহান, সলিমুল্লাহ ও শের শাহ সূরি চেকপয়েন্ট ছুঁয়ে যান।',
    descEn: 'Beat the clock and rivals across Nurjahan, Salimullah & Sher Shah checkpoints.',
    waypointPlaceIds: ['tea', 'salimullah', 'garage', 'bazaar'],
    targetSeconds: 125,
    cashReward: 185,
    repReward: 95,
    lossFee: 22,
    rivalBaseSpeed: 6.4,
  },
  {
    id: 'ev_delivery_bazaar',
    kind: 'delivery_rush',
    titleBn: 'টাউন হল এক্সপ্রেস ডেলিভারি',
    titleEn: 'Town Hall Express Delivery',
    descBn: 'কাঁচাবাজার থেকে তাজমহল লাইব্রেরি হয়ে হুমায়ুন রোডে জরুরি ডেলিভারি।',
    descEn: 'Urgent market cargo run from Town Hall to Tajmahal Library & Humayun Rd.',
    waypointPlaceIds: ['bazaar', 'library', 'humayun'],
    targetSeconds: 140,
    cashReward: 190,
    repReward: 100,
    lossFee: 22,
    rivalBaseSpeed: 6.3,
  },
  {
    id: 'ev_shortcut_gali',
    kind: 'shortcut_challenge',
    titleBn: 'তাজমহল গলি শর্টকাট চ্যালেঞ্জ',
    titleEn: 'Tajmahal Gali Shortcut Challenge',
    descBn: 'ভেতরের গলি চিনে শিয়া মসজিদ থেকে জাকির হোসেন রোডে সবার আগে পৌঁছান।',
    descEn: 'Cut through inner Mohammadpur alleys from Shia Mosque to Zakir Hossain Rd.',
    waypointPlaceIds: ['mosque', 'library', 'zakir'],
    targetSeconds: 155,
    cashReward: 180,
    repReward: 95,
    lossFee: 20,
    rivalBaseSpeed: 6.3,
  },
  {
    id: 'ev_pursuit_satmasjid',
    kind: 'pursuit_escape',
    titleBn: 'সাতমসজিদ সাইরেন এস্কেপ',
    titleEn: 'Satmasjid Siren Escape',
    descBn: 'পুলিশের হিট ২ তাড়া ও ব্যারিকেড এড়িয়ে সাতমসজিদ থেকে বাবর রোডে পালান!',
    descEn: 'Break through Heat 2 police units & barricades from Satmasjid to Babar Rd!',
    waypointPlaceIds: ['launch', 'stand', 'mosque', 'bridge'],
    targetSeconds: 150,
    cashReward: 240,
    repReward: 135,
    lossFee: 28,
    rivalBaseSpeed: 6.8,
    heatLevel: 2,
    roadblockCount: 2,
  },
  {
    id: 'ev_duel_ring',
    kind: 'rival_duel',
    titleBn: 'রিং রোড স্পিড শোডাউন',
    titleEn: 'Ring Road 4-Way Showdown',
    descBn: 'রিং রোড মার্কেট থেকে টাউন হল হয়ে ইকবাল স্কুলে হাই-স্পিড রাইভাল রেস।',
    descEn: 'High-speed rival race from Ring Rd Market through Town Hall to Iqbal School.',
    waypointPlaceIds: ['market', 'bazaar', 'school'],
    targetSeconds: 185,
    cashReward: 210,
    repReward: 115,
    lossFee: 25,
    rivalBaseSpeed: 6.9,
    roadblockCount: 1,
  },
  {
    id: 'ev_survival_jam',
    kind: 'traffic_survival',
    titleBn: 'আসাদ গেট ট্রাফিক সার্ভাইভাল',
    titleEn: 'Asad Gate Traffic Survival Run',
    descBn: 'ব্যস্ত ট্রাফিকের ভেতর বড় ধাক্কা ছাড়াই পোস্ট অফিস থেকে সাতমসজিদ রোডে যান।',
    descEn: 'Weave cleanly through peak traffic from Post Office to Satmasjid Launch.',
    waypointPlaceIds: ['pharmacy', 'bazaar', 'stand', 'launch'],
    targetSeconds: 100,
    cashReward: 200,
    repReward: 110,
    lossFee: 24,
    rivalBaseSpeed: 6.5,
  },
];

export function rivalByRank(rank: number): BlacklistRival | undefined {
  return BLACKLIST_RIVALS.find((r) => r.rank === rank);
}

export function eventById(id: string): RivalEventSpec | undefined {
  for (const r of BLACKLIST_RIVALS) {
    if (r.bossEvent.id === id) return r.bossEvent;
  }
  return OPEN_STREET_EVENTS.find((e) => e.id === id);
}

export interface RaceRivalSlotConfig {
  rival: BlacklistRival;
  tendency: AiRacingTendency;
  speedScale: number;
}

/**
 * Deterministic selection of 3 distinct, non-duplicate AI opponents for a
 * 4-rickshaw race (`player + 3 AI rivals`), guaranteeing complementary racing
 * tendencies (`clean_line`, `aggressive_overtaker`, `shortcut_seeker`)!
 */
export function selectRaceRivalTrio(
  event: RivalEventSpec,
  primaryRival: BlacklistRival | null,
): [RaceRivalSlotConfig, RaceRivalSlotConfig, RaceRivalSlotConfig] {
  const usedIds = new Set<string>();
  const picked: BlacklistRival[] = [];

  if (primaryRival) {
    picked.push(primaryRival);
    usedIds.add(primaryRival.id);
  }

  // Deterministic hash from event.id so Open Street Events get varied trios
  let seed = 0;
  for (let i = 0; i < event.id.length; i++) seed = (seed * 31 + event.id.charCodeAt(i)) >>> 0;

  // Prefer peers near the boss's rank (or mid-table #10..#5 for Open Street Events)
  const anchorIdx = primaryRival
    ? BLACKLIST_RIVALS.findIndex((r) => r.id === primaryRival.id)
    : seed % 5;

  const candidateOrder = [
    anchorIdx,
    anchorIdx - 1,
    anchorIdx + 1,
    anchorIdx - 2,
    anchorIdx + 2,
    (seed + 1) % BLACKLIST_RIVALS.length,
    (seed + 3) % BLACKLIST_RIVALS.length,
    (seed + 5) % BLACKLIST_RIVALS.length,
    0,
    1,
    2,
    3,
  ];
  for (const rawIdx of candidateOrder) {
    if (picked.length >= 3) break;
    const idx = ((rawIdx % BLACKLIST_RIVALS.length) + BLACKLIST_RIVALS.length) % BLACKLIST_RIVALS.length;
    const cand = BLACKLIST_RIVALS[idx];
    if (!usedIds.has(cand.id)) {
      usedIds.add(cand.id);
      picked.push(cand);
    }
  }

  // Assign distinct complementary tendencies across the 3 AI slots while honoring the boss's signature style!
  const allTendencies: AiRacingTendency[] = ['clean_line', 'aggressive_overtaker', 'shortcut_seeker'];
  const leadTendency = picked[0].tendency;
  const remaining = allTendencies.filter((t) => t !== leadTendency);

  return [
    { rival: picked[0], tendency: leadTendency, speedScale: 1.0 },
    { rival: picked[1], tendency: remaining[0], speedScale: 0.96 },
    { rival: picked[2], tendency: remaining[1], speedScale: 0.93 },
  ];
}

/**
 * Crisp inline SVG bust portrait of a Blacklist rival character matching their
 * exact 3D skin tone, eyes, eyebrows, mouth expression, eyewear, hair/headwear
 * silhouette, and outfit shoulders (zero external asset downloads or leaks).
 */
export function renderRivalPortraitSvg(rival: BlacklistRival): string {
  const c = rival.character;
  const browL =
    c.expression === 'fierce'
      ? 'M19 25 L26 27'
      : c.expression === 'grin'
        ? 'M19 26 L26 25'
        : 'M19 25.5 L26 26';
  const browR =
    c.expression === 'fierce'
      ? 'M45 25 L38 27'
      : c.expression === 'grin'
        ? 'M45 26 L38 25'
        : 'M45 25.5 L38 26';
  const mouth =
    c.expression === 'grin'
      ? '<path d="M26 39 Q32 44 38 39" fill="#ffffff" stroke="#3b1818" stroke-width="1.6"/>'
      : c.expression === 'fierce'
        ? '<path d="M26 40 L38 38.5" stroke="#3b1818" stroke-width="2.1" stroke-linecap="round"/>'
        : '<path d="M27 39.5 L37 39.5" stroke="#3b1818" stroke-width="2" stroke-linecap="round"/>';

  let headwear = '';
  switch (c.hairStyle) {
    case 'bandana':
      headwear = `<path d="M16 21 Q32 11 48 21 L47 25 L17 25 Z" fill="${c.headwearHex}"/><path d="M47 22 L55 27 L52 30 L46 25 Z" fill="${c.accentHex}"/>`;
      break;
    case 'peaked_cap':
      headwear = `<path d="M16 22 Q32 9 48 22 Z" fill="${c.headwearHex}"/><rect x="15" y="20" width="36" height="4" rx="2" fill="${c.accentHex}"/>`;
      break;
    case 'spiky':
      headwear = `<path d="M16 22 L21 9 L28 16 L33 7 L39 16 L45 10 L48 22 Z" fill="${c.hairHex}"/><rect x="16" y="20" width="32" height="3.5" rx="1.5" fill="${c.headwearHex}"/>`;
      break;
    case 'ponytail_bun':
      headwear = `<circle cx="49" cy="24" r="6" fill="${c.hairHex}"/><path d="M16 23 Q32 10 48 23 Z" fill="${c.hairHex}"/><rect x="17" y="20" width="30" height="3" rx="1.5" fill="${c.headwearHex}"/>`;
      break;
    case 'pagri_wrap':
      headwear = `<ellipse cx="32" cy="18" rx="18" ry="9" fill="${c.headwearHex}"/><path d="M17 18 Q32 11 47 20" stroke="${c.accentHex}" stroke-width="3.5" fill="none"/>`;
      break;
    case 'bucket_hat':
      headwear = `<path d="M18 21 L21 11 L43 11 L46 21 Z" fill="${c.headwearHex}"/><ellipse cx="32" cy="21" rx="20" ry="3.5" fill="${c.headwearHex}"/><rect x="20" y="17" width="24" height="2.8" fill="${c.accentHex}"/>`;
      break;
    case 'curly':
      headwear = `<circle cx="22" cy="16" r="6" fill="${c.hairHex}"/><circle cx="32" cy="13" r="7" fill="${c.hairHex}"/><circle cx="42" cy="16" r="6" fill="${c.hairHex}"/>`;
      break;
    case 'crown_bandana':
      headwear = `<path d="M16 22 Q32 12 48 22 L47 25 L17 25 Z" fill="${c.headwearHex}"/><polygon points="28,22 32,13 36,22" fill="${c.accentHex}"/>`;
      break;
    default:
      headwear = `<path d="M16 22 Q32 11 48 22 Z" fill="${c.headwearHex}"/>`;
      break;
  }

  const eyewear =
    c.eyewear === 'aviator'
      ? '<rect x="19" y="27" width="11" height="6.5" rx="2" fill="#0f172a"/><rect x="34" y="27" width="11" height="6.5" rx="2" fill="#0f172a"/><line x1="30" y1="29" x2="34" y2="29" stroke="#facc15" stroke-width="1.5"/>'
      : c.eyewear === 'sport_visor'
        ? `<rect x="18" y="27" width="28" height="6" rx="2.5" fill="${c.accentHex}" opacity="0.9"/>`
        : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="52" height="52" role="img" aria-hidden="true">
    <rect width="64" height="64" rx="12" fill="#0f172a" stroke="${rival.accentHex}" stroke-width="2"/>
    <path d="M10 62 Q14 45 32 45 Q50 45 54 62 Z" fill="${c.topHex}"/>
    <path d="M24 46 L32 56 L40 46" fill="${c.accentHex}" opacity="0.85"/>
    <rect x="28" y="40" width="8" height="8" fill="${c.skinHex}"/>
    <ellipse cx="16" cy="32" rx="2.6" ry="4.2" fill="${c.skinHex}"/>
    <ellipse cx="48" cy="32" rx="2.6" ry="4.2" fill="${c.skinHex}"/>
    <rect x="17" y="18" width="30" height="27" rx="13" fill="${c.skinHex}"/>
    <rect x="20.5" y="28.5" width="6.5" height="4" rx="1.5" fill="#ffffff"/>
    <rect x="37" y="28.5" width="6.5" height="4" rx="1.5" fill="#ffffff"/>
    <circle cx="24" cy="30.5" r="1.8" fill="#111827"/>
    <circle cx="40" cy="30.5" r="1.8" fill="#111827"/>
    <path d="${browL}" stroke="${c.hairHex}" stroke-width="2.1" stroke-linecap="round"/>
    <path d="${browR}" stroke="${c.hairHex}" stroke-width="2.1" stroke-linecap="round"/>
    <path d="M32 30 L30.8 35.5 L33.5 35.5" fill="none" stroke="#5c3620" stroke-width="1.4" stroke-linecap="round"/>
    ${eyewear}
    ${mouth}
    ${headwear}
  </svg>`;
}

