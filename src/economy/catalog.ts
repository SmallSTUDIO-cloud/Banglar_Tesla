/**
 * Data-driven catalogue for vehicles, functional upgrades, cosmetics and tapes.
 * Prices and effects live here so the economy can be tuned without touching UI
 * or gameplay code. All prices are in integer taka.
 */

export type StatId = 'speed' | 'handling' | 'comfort' | 'braking';

export interface VehicleStats {
  speed: number;
  handling: number;
  comfort: number;
  braking: number;
}

export interface VehicleDef {
  id: string;
  nameKey: string;
  descKey: string;
  price: number;
  ownedByDefault: boolean;
  stats: VehicleStats;
  /** Painted body / panel colours used by the procedural model. */
  palette: {
    body: string;
    panel: string;
    canopy: string;
    trim: string;
    seat: string;
  };
  artStyle: 'floral' | 'bird' | 'river' | 'cinema';
  /** Minimum rides completed before the vehicle is listed as purchasable. */
  ridesRequired: number;
}

export interface UpgradeDef {
  id: string;
  nameKey: string;
  descKey: string;
  maxLevel: number;
  prices: number[];
  stat: StatId | 'grip' | 'night' | 'rain';
  perLevel: number;
}

export type CosmeticCategory = 'paint' | 'art' | 'tassel' | 'bell' | 'flowers' | 'mirror';

export interface CosmeticDef {
  id: string;
  nameKey: string;
  category: CosmeticCategory;
  price: number;
  /** Paint colour / art style / colour / bell variant / decoration variant. */
  value: string;
  swatch: [string, string];
}

export interface TapeDef {
  id: string;
  nameKey: string;
  /** Rides needed to unlock this cassette. */
  unlockRides: number;
}

export const VEHICLES: VehicleDef[] = [
  {
    id: 'classic',
    nameKey: 'veh.classic',
    descKey: 'veh.classic.desc',
    price: 0,
    ownedByDefault: true,
    stats: { speed: 0.5, handling: 0.52, comfort: 0.45, braking: 0.46 },
    palette: {
      body: '#b8322a',
      panel: '#e8b25a',
      canopy: '#1f1a16',
      trim: '#d9c39a',
      seat: '#8e2a22',
    },
    artStyle: 'floral',
    ridesRequired: 0,
  },
  {
    id: 'neel',
    nameKey: 'veh.neel',
    descKey: 'veh.neel.desc',
    price: 2400,
    ownedByDefault: false,
    stats: { speed: 0.56, handling: 0.62, comfort: 0.52, braking: 0.51 },
    palette: {
      body: '#1c3f7a',
      panel: '#8fc7e8',
      canopy: '#101a2c',
      trim: '#c7d6e6',
      seat: '#20365c',
    },
    artStyle: 'river',
    ridesRequired: 3,
  },
  {
    id: 'shapla',
    nameKey: 'veh.shapla',
    descKey: 'veh.shapla.desc',
    price: 3600,
    ownedByDefault: false,
    stats: { speed: 0.53, handling: 0.58, comfort: 0.62, braking: 0.53 },
    palette: {
      body: '#1c5a3a',
      panel: '#d63b2f',
      canopy: '#24180f',
      trim: '#f0d9a8',
      seat: '#a52d24',
    },
    artStyle: 'floral',
    ridesRequired: 6,
  },
  {
    id: 'cinema',
    nameKey: 'veh.cinema',
    descKey: 'veh.cinema.desc',
    price: 6500,
    ownedByDefault: false,
    stats: { speed: 0.62, handling: 0.6, comfort: 0.66, braking: 0.58 },
    palette: {
      body: '#7a1420',
      panel: '#f0c04a',
      canopy: '#150f14',
      trim: '#e8c877',
      seat: '#5c101a',
    },
    artStyle: 'cinema',
    ridesRequired: 10,
  },
];

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'tyres',
    nameKey: 'up.tyres',
    descKey: 'up.tyres.desc',
    maxLevel: 3,
    prices: [320, 760, 1480],
    stat: 'grip',
    perLevel: 0.11,
  },
  {
    id: 'brakes',
    nameKey: 'up.brakes',
    descKey: 'up.brakes.desc',
    maxLevel: 3,
    prices: [280, 680, 1320],
    stat: 'braking',
    perLevel: 0.09,
  },
  {
    id: 'bearings',
    nameKey: 'up.bearings',
    descKey: 'up.bearings.desc',
    maxLevel: 3,
    prices: [360, 820, 1600],
    stat: 'speed',
    perLevel: 0.07,
  },
  {
    id: 'steering',
    nameKey: 'up.steering',
    descKey: 'up.steering.desc',
    maxLevel: 3,
    prices: [300, 700, 1400],
    stat: 'handling',
    perLevel: 0.08,
  },
  {
    id: 'seat',
    nameKey: 'up.seat',
    descKey: 'up.seat.desc',
    maxLevel: 3,
    prices: [260, 620, 1250],
    stat: 'comfort',
    perLevel: 0.1,
  },
  {
    id: 'canopy',
    nameKey: 'up.canopy',
    descKey: 'up.canopy.desc',
    maxLevel: 2,
    prices: [420, 980],
    stat: 'rain',
    perLevel: 0.18,
  },
  {
    id: 'lights',
    nameKey: 'up.lights',
    descKey: 'up.lights.desc',
    maxLevel: 2,
    prices: [240, 560],
    stat: 'night',
    perLevel: 0.2,
  },
];

export const COSMETICS: CosmeticDef[] = [
  { id: 'paint.red', nameKey: 'cos.paint.red', category: 'paint', price: 180, value: '#b8322a', swatch: ['#b8322a', '#e8b25a'] },
  { id: 'paint.blue', nameKey: 'cos.paint.blue', category: 'paint', price: 260, value: '#1c4f8a', swatch: ['#1c4f8a', '#8fc7e8'] },
  { id: 'paint.green', nameKey: 'cos.paint.green', category: 'paint', price: 260, value: '#1c5a3a', swatch: ['#1c5a3a', '#d6c07a'] },
  { id: 'paint.gold', nameKey: 'cos.paint.gold', category: 'paint', price: 420, value: '#a87a22', swatch: ['#a87a22', '#f5dca0'] },
  { id: 'paint.teal', nameKey: 'cos.paint.teal', category: 'paint', price: 340, value: '#155f5c', swatch: ['#155f5c', '#a9e2d4'] },
  { id: 'art.floral', nameKey: 'cos.art.floral', category: 'art', price: 300, value: 'floral', swatch: ['#c0392b', '#2f7d4f'] },
  { id: 'art.bird', nameKey: 'cos.art.bird', category: 'art', price: 380, value: 'bird', swatch: ['#1c6fa8', '#f0c04a'] },
  { id: 'art.river', nameKey: 'cos.art.river', category: 'art', price: 460, value: 'river', swatch: ['#1c4f8a', '#bfe6f5'] },
  { id: 'art.cinema', nameKey: 'cos.art.cinema', category: 'art', price: 620, value: 'cinema', swatch: ['#7a1420', '#f0c04a'] },
  { id: 'tassel.red', nameKey: 'cos.tassel.red', category: 'tassel', price: 120, value: '#d63b2f', swatch: ['#d63b2f', '#f6e0b0'] },
  { id: 'tassel.gold', nameKey: 'cos.tassel.gold', category: 'tassel', price: 160, value: '#e8b25a', swatch: ['#e8b25a', '#9a6a1c'] },
  { id: 'tassel.green', nameKey: 'cos.tassel.green', category: 'tassel', price: 140, value: '#1c7a4f', swatch: ['#1c7a4f', '#c9f0d8'] },
  { id: 'bell.classic', nameKey: 'cos.bell.classic', category: 'bell', price: 0, value: 'classic', swatch: ['#c9a35a', '#5a4a2a'] },
  { id: 'bell.brass', nameKey: 'cos.bell.brass', category: 'bell', price: 220, value: 'brass', swatch: ['#e0b25a', '#7a5a1c'] },
  { id: 'bell.double', nameKey: 'cos.bell.double', category: 'bell', price: 340, value: 'double', swatch: ['#d6d6d6', '#7a7a7a'] },
  { id: 'flowers.marigold', nameKey: 'cos.flowers.marigold', category: 'flowers', price: 150, value: 'marigold', swatch: ['#f0a500', '#7a4a00'] },
  { id: 'flowers.rose', nameKey: 'cos.flowers.rose', category: 'flowers', price: 190, value: 'rose', swatch: ['#d64a6a', '#7a1030'] },
  { id: 'mirror.round', nameKey: 'cos.mirror.round', category: 'mirror', price: 130, value: 'round', swatch: ['#cfd8dd', '#61707a'] },
  { id: 'mirror.star', nameKey: 'cos.mirror.star', category: 'mirror', price: 260, value: 'star', swatch: ['#e8dcc0', '#8a7a4a'] },
];

export const TAPES: TapeDef[] = [
  { id: 'cassette', nameKey: 'tape.cassette', unlockRides: 0 },
  { id: 'radio', nameKey: 'tape.radio', unlockRides: 2 },
  { id: 'brishti', nameKey: 'tape.brishti', unlockRides: 5 },
];

export const DEFAULT_COSMETICS: Record<CosmeticCategory, string> = {
  paint: 'paint.red',
  art: 'art.floral',
  tassel: 'tassel.red',
  bell: 'bell.classic',
  flowers: 'flowers.marigold',
  mirror: 'mirror.round',
};

export function vehicleById(id: string): VehicleDef {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

export function upgradeById(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export function cosmeticById(id: string): CosmeticDef | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export const COSMETIC_CATEGORIES: CosmeticCategory[] = ['paint', 'art', 'tassel', 'bell', 'flowers', 'mirror'];

export function cosmeticsByCategory(category: CosmeticCategory): CosmeticDef[] {
  return COSMETICS.filter((c) => c.category === category);
}
