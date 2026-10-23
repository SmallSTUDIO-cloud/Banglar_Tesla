/**
 * Hand-authored layout of the Old-Dhaka-inspired neighbourhood.
 * A compact, irregular block of lanes around a main road, a cross road,
 * two "gali" (narrow lanes) and a riverfront-inspired northern edge.
 *
 * Units are metres. +X east, +Z south. The player spawns on the main road.
 */

export type Axis = 'x' | 'z';

export interface RoadDef {
  id: string;
  axis: Axis;
  /** Centre line coordinate on the perpendicular axis. */
  center: number;
  from: number;
  to: number;
  width: number;
  sidewalk: number;
  kind: 'main' | 'cross' | 'lane' | 'gali';
  /** Lane line markings for wider roads. */
  markings: boolean;
}

export const ROADS: RoadDef[] = [
  { id: 'main', axis: 'z', center: 0, from: -112, to: 112, width: 9.2, sidewalk: 1.9, kind: 'main', markings: true },
  { id: 'cross', axis: 'x', center: 0, from: -112, to: 112, width: 7.4, sidewalk: 1.7, kind: 'cross', markings: true },
  { id: 'south-lane', axis: 'x', center: 55, from: -74, to: 74, width: 5.2, sidewalk: 1.2, kind: 'lane', markings: false },
  { id: 'north-lane', axis: 'x', center: -55, from: -74, to: 74, width: 5.2, sidewalk: 1.2, kind: 'lane', markings: false },
  { id: 'west-lane', axis: 'z', center: -52, from: -74, to: 74, width: 5.0, sidewalk: 1.15, kind: 'lane', markings: false },
  { id: 'east-lane', axis: 'z', center: 52, from: -74, to: 74, width: 5.0, sidewalk: 1.15, kind: 'lane', markings: false },
  // Narrow service lanes ("gali") — dead ends with shops, tea stalls and props.
  { id: 'gali-tea', axis: 'x', center: 20, from: 6, to: 30, width: 3.4, sidewalk: 0.7, kind: 'gali', markings: false },
  { id: 'gali-repair', axis: 'x', center: -20, from: -34, to: -6, width: 3.6, sidewalk: 0.7, kind: 'gali', markings: false },
  { id: 'gali-book', axis: 'x', center: 30, from: 34, to: 48, width: 3.2, sidewalk: 0.7, kind: 'gali', markings: false },
];

export interface BlockDef {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Which block edges face a road that gets shopfronts: 'n','s','e','w'. */
  faces: ('n' | 's' | 'e' | 'w')[];
  storeys: [number, number];
  style: 'shops' | 'mixed' | 'residential';
}

export const BLOCKS: BlockDef[] = [
  { id: 'nw-inner', x1: -44, z1: -46, x2: -8.6, z2: -8.6, faces: ['e', 's'], storeys: [2, 4], style: 'shops' },
  { id: 'ne-inner', x1: 8.6, z1: -46, x2: 44, z2: -8.6, faces: ['w', 's'], storeys: [2, 5], style: 'mixed' },
  { id: 'sw-inner', x1: -44, z1: 8.6, x2: -8.6, z2: 49, faces: ['e', 'n'], storeys: [2, 4], style: 'shops' },
  { id: 'se-inner', x1: 8.6, z1: 8.6, x2: 44, z2: 49, faces: ['w', 'n'], storeys: [2, 5], style: 'mixed' },
  { id: 'nw-outer', x1: -104, z1: -46, x2: -60, z2: -8.6, faces: ['e'], storeys: [2, 4], style: 'residential' },
  { id: 'ne-outer', x1: 60, z1: -46, x2: 104, z2: -8.6, faces: ['w'], storeys: [2, 3], style: 'residential' },
  { id: 'sw-outer', x1: -104, z1: 8.6, x2: -60, z2: 49, faces: ['e'], storeys: [2, 4], style: 'mixed' },
  { id: 'se-outer', x1: 60, z1: 8.6, x2: 104, z2: 49, faces: ['w'], storeys: [2, 3], style: 'residential' },
  { id: 's-gate', x1: -44, z1: 60, x2: -8.6, z2: 96, faces: ['n', 'e'], storeys: [2, 4], style: 'shops' },
  { id: 's-mill', x1: 8.6, z1: 60, x2: 44, z2: 96, faces: ['n', 'w'], storeys: [2, 3], style: 'residential' },
  { id: 'n-ghat', x1: -44, z1: -96, x2: -8.6, z2: -60, faces: ['s', 'e'], storeys: [1, 3], style: 'shops' },
  { id: 'n-yard', x1: 8.6, z1: -96, x2: 44, z2: -60, faces: ['s', 'w'], storeys: [1, 2], style: 'shops' },
  { id: 'deep-west', x1: -128, z1: 60, x2: -60, z2: 96, faces: ['n'], storeys: [1, 2], style: 'residential' },
  { id: 'deep-east', x1: 60, z1: 60, x2: 128, z2: 96, faces: ['n'], storeys: [1, 2], style: 'residential' },
  { id: 'deep-nwest', x1: -128, z1: -96, x2: -60, z2: -60, faces: ['s'], storeys: [1, 2], style: 'shops' },
  { id: 'deep-neast', x1: 60, z1: -96, x2: 128, z2: -60, faces: ['s'], storeys: [1, 2], style: 'residential' },
];

export interface PlaceDef {
  id: string;
  nameKey: string;
  x: number;
  z: number;
  radius: number;
  kind: 'pickup' | 'drop' | 'both';
  /** Marker height in metres. */
  marker: number;
}

/** Every zone sits *on* a drivable road so a rickshaw can actually stop in it. */
export const PLACES: PlaceDef[] = [
  { id: 'stand', nameKey: 'place.stand', x: -3.2, z: 46, radius: 6.6, kind: 'both', marker: 3.2 },
  { id: 'tea', nameKey: 'place.tea', x: 3.4, z: 11, radius: 6.4, kind: 'both', marker: 3.0 },
  { id: 'bazaar', nameKey: 'place.bazaar', x: -30, z: 55, radius: 7.0, kind: 'both', marker: 3.2 },
  { id: 'school', nameKey: 'place.school', x: 3.4, z: -55, radius: 6.8, kind: 'both', marker: 3.4 },
  { id: 'garage', nameKey: 'place.garage', x: -3.4, z: -70, radius: 6.6, kind: 'both', marker: 3.0 },
  { id: 'pharmacy', nameKey: 'place.pharmacy', x: -28, z: 2.6, radius: 6.4, kind: 'both', marker: 3.1 },
  { id: 'launch', nameKey: 'place.launch', x: 0, z: -100, radius: 7.4, kind: 'both', marker: 3.6 },
  { id: 'mosque', nameKey: 'place.mosque', x: -52, z: -30, radius: 6.4, kind: 'both', marker: 3.2 },
  { id: 'market', nameKey: 'place.market', x: -52, z: 26, radius: 6.4, kind: 'both', marker: 3.2 },
  { id: 'bridge', nameKey: 'place.bridge', x: 52, z: 20, radius: 6.4, kind: 'both', marker: 3.2 },
  { id: 'library', nameKey: 'place.library', x: 26, z: 55, radius: 6.6, kind: 'both', marker: 3.2 },
];

export function placeById(id: string): PlaceDef | undefined {
  return PLACES.find((p) => p.id === id);
}

/** Painted shop signs. Fictional businesses only — no real brands. */
export interface SignDef {
  bn: string;
  sub?: string;
  bg: string;
  fg: string;
  style: 'board' | 'shutter' | 'banner';
}

export const SIGN_POOL: SignDef[] = [
  { bn: 'চায়ের দোকান', sub: 'গরম চা • সিঙ্গারা', bg: '#1d5a41', fg: '#f7e6b8', style: 'board' },
  { bn: 'মুদি দোকান', sub: 'মসলা • চাল • ডাল', bg: '#8c2f22', fg: '#ffeccd', style: 'board' },
  { bn: 'রিকশা মেরামত', sub: 'টায়ার • চেইন • বেল', bg: '#2a3d5a', fg: '#e8e0c8', style: 'board' },
  { bn: 'ফার্মেসি', sub: 'ওষুধ সকাল ৮টা - রাত ১০টা', bg: '#125a4a', fg: '#f1f7e8', style: 'board' },
  { bn: 'বই ঘর', sub: 'পুরনো বই • খাতা', bg: '#5c3a1e', fg: '#f5e6c4', style: 'board' },
  { bn: 'ভাড়া হবে', sub: 'যোগাযোগ: মালিক', bg: '#e8d7a8', fg: '#3a2a12', style: 'banner' },
  { bn: 'সোনার বাংলা স্টোর', sub: 'কাপড় • থান', bg: '#7b1f4a', fg: '#ffe9c8', style: 'board' },
  { bn: 'আকাশ মোবাইল', sub: 'রিচার্জ • সার্ভিসিং', bg: '#123c66', fg: '#d9ecff', style: 'board' },
  { bn: 'রহিম মিষ্টান্ন ভাণ্ডার', sub: 'রসগোল্লা • সন্দেশ', bg: '#a83a1c', fg: '#fff2d4', style: 'board' },
  { bn: 'বন্ধু ফটোকপি', sub: 'প্রিন্ট • লেমিনেশন', bg: '#1f4f33', fg: '#e8ffd9', style: 'board' },
  { bn: 'মা টেইলার্স', sub: 'সেলাই • ব্লাউজ', bg: '#4a2b6b', fg: '#f0e2ff', style: 'board' },
  { bn: 'হোটেল আল-কারিম', sub: 'খিচুড়ি • ভাত • মাছ', bg: '#14506b', fg: '#f3ead6', style: 'board' },
  { bn: 'টুটুল ইলেকট্রনিক্স', sub: 'ফ্যান • বাল্ব • মেরামত', bg: '#2c2f38', fg: '#ffe083', style: 'board' },
  { bn: 'জমজম কেবিন', sub: 'চা • পরোটা', bg: '#3d5c2a', fg: '#f7f0d2', style: 'board' },
  { bn: 'নীল দরিয়া বস্ত্রালয়', sub: 'শাড়ি • থ্রি-পিস', bg: '#1b3a63', fg: '#e4f0ff', style: 'board' },
  { bn: 'শাপলা ফটো স্টুডিও', sub: 'ছবি • ফ্রেম', bg: '#6b1d33', fg: '#ffe9d6', style: 'board' },
];

export interface PropSpot {
  kind: 'tea' | 'cart' | 'crates' | 'tires' | 'barrier' | 'bench' | 'poles' | 'bins' | 'stand';
  x: number;
  z: number;
  yaw?: number;
}

/** Hand-placed street clutter so density follows composition, not noise. */
export const PROPS: PropSpot[] = [
  { kind: 'tea', x: 7.4, z: 12.5, yaw: -0.35 },
  { kind: 'tea', x: -8.2, z: -18, yaw: 1.1 },
  { kind: 'cart', x: -7.2, z: 26, yaw: 0.2 },
  { kind: 'cart', x: -49, z: 34, yaw: 1.6 },
  { kind: 'crates', x: 6.8, z: 33, yaw: 0 },
  { kind: 'crates', x: -46.5, z: -14, yaw: 0.4 },
  { kind: 'tires', x: -6.5, z: -63, yaw: 0 },
  { kind: 'tires', x: 7.5, z: 52, yaw: 0.3 },
  { kind: 'barrier', x: 2.2, z: -38, yaw: 0 },
  { kind: 'barrier', x: -46, z: 15, yaw: 1.5 },
  { kind: 'bench', x: 6.6, z: 9.5, yaw: 0 },
  { kind: 'bins', x: -6.2, z: 4.8, yaw: 0 },
  { kind: 'bins', x: 6.4, z: 44, yaw: 0 },
  { kind: 'stand', x: -7.2, z: 47.5, yaw: 1.4 },
  { kind: 'poles', x: 0, z: 0 },
];
