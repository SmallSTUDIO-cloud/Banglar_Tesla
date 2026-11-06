/**
 * Everything the player can buy or equip: rickshaw frames (pedal, electric,
 * and the non-purchasable Roadster teaser), mechanical/electrical upgrades,
 * paints, panel art and small accessories. Pure data.
 */

export type VehicleDriveKind = 'pedal' | 'electric' | 'roadster';
export type VehicleKind = VehicleDriveKind;

export interface VehicleDef {
  id: string;
  nameKey: string;
  descKey: string;
  kind: VehicleDriveKind;
  price: number;
  ownedByDefault?: boolean;
  comingSoon?: boolean;
  ridesRequired: number;
  palette: {
    body: string;
    canopy: string;
    trim: string;
    panel: string;
    seat: string;
  };
  /** Normalised base stats shown on the garage & Dokan bars (0..1). */
  stats: {
    speed: number;
    handling: number;
    comfort: number;
    braking: number;
  };
  /** Additive physics modifiers on top of RIDE defaults. */
  topSpeedBonus: number;
  accelMultiplier: number;
  brakeBonus?: number;
  gripBonus?: number;
}

export const VEHICLES: VehicleDef[] = [
  {
    id: 'classic',
    nameKey: 'veh.classic',
    descKey: 'veh.classic.desc',
    kind: 'pedal',
    price: 0,
    ownedByDefault: true,
    ridesRequired: 0,
    palette: {
      body: '#176b52',
      canopy: '#a82230',
      trim: '#e8b25a',
      panel: '#f5d47a',
      seat: '#7a1f28',
    },
    stats: { speed: 0.52, handling: 0.64, comfort: 0.56, braking: 0.58 },
    topSpeedBonus: 0,
    accelMultiplier: 1,
    brakeBonus: 0,
    gripBonus: 0,
  },
  {
    id: 'neel',
    nameKey: 'veh.neel',
    descKey: 'veh.neel.desc',
    kind: 'pedal',
    price: 1200,
    ridesRequired: 2,
    palette: {
      body: '#123e73',
      canopy: '#1f5ea8',
      trim: '#d9e7ff',
      panel: '#5cb3ff',
      seat: '#162844',
    },
    stats: { speed: 0.61, handling: 0.72, comfort: 0.62, braking: 0.65 },
    topSpeedBonus: 0.45,
    accelMultiplier: 1.08,
    brakeBonus: 0.25,
    gripBonus: 0.04,
  },
  {
    id: 'shapla',
    nameKey: 'veh.shapla',
    descKey: 'veh.shapla.desc',
    kind: 'pedal',
    price: 2100,
    ridesRequired: 5,
    palette: {
      body: '#9e1c28',
      canopy: '#1f6a3f',
      trim: '#f4c04a',
      panel: '#f66f5b',
      seat: '#4c1419',
    },
    stats: { speed: 0.67, handling: 0.74, comfort: 0.74, braking: 0.69 },
    topSpeedBonus: 0.72,
    accelMultiplier: 1.13,
    brakeBonus: 0.4,
    gripBonus: 0.06,
  },
  {
    id: 'cinema',
    nameKey: 'veh.cinema',
    descKey: 'veh.cinema.desc',
    kind: 'pedal',
    price: 3600,
    ridesRequired: 12,
    palette: {
      body: '#3a1a52',
      canopy: '#c43e2f',
      trim: '#f5c258',
      panel: '#ff9b54',
      seat: '#2a0f3a',
    },
    stats: { speed: 0.75, handling: 0.78, comfort: 0.82, braking: 0.75 },
    topSpeedBonus: 1.05,
    accelMultiplier: 1.18,
    brakeBonus: 0.55,
    gripBonus: 0.08,
  },
  {
    id: 'electric',
    nameKey: 'veh.electric',
    descKey: 'veh.electric.desc',
    kind: 'electric',
    price: 3200,
    ridesRequired: 0,
    palette: {
      body: '#0c7c69',
      canopy: '#153a54',
      trim: '#5df2c8',
      panel: '#f2c14e',
      seat: '#162d38',
    },
    stats: { speed: 0.86, handling: 0.79, comfort: 0.81, braking: 0.83 },
    topSpeedBonus: 2.35,
    accelMultiplier: 1.52,
    brakeBonus: 0.95,
    gripBonus: 0.1,
  },
  {
    id: 'roadster',
    nameKey: 'veh.roadster',
    descKey: 'veh.roadster.desc',
    kind: 'roadster',
    price: 0,
    comingSoon: true,
    ridesRequired: 9999,
    palette: {
      body: '#b81d2a',
      canopy: '#151922',
      trim: '#ffd166',
      panel: '#ff5964',
      seat: '#1d1118',
    },
    stats: { speed: 0.98, handling: 0.94, comfort: 0.9, braking: 0.95 },
    topSpeedBonus: 4.0,
    accelMultiplier: 2.0,
    brakeBonus: 1.5,
    gripBonus: 0.18,
  },
];

export interface UpgradeDef {
  id: string;
  nameKey: string;
  descKey: string;
  maxLevel: number;
  prices: number[];
  ridesRequired?: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'bearings', nameKey: 'up.bearings', descKey: 'up.bearings.desc', maxLevel: 3, prices: [360, 820, 1500] },
  { id: 'brakes', nameKey: 'up.brakes', descKey: 'up.brakes.desc', maxLevel: 3, prices: [280, 680, 1300] },
  { id: 'tyres', nameKey: 'up.tyres', descKey: 'up.tyres.desc', maxLevel: 3, prices: [320, 720, 1400] },
  { id: 'steering', nameKey: 'up.steering', descKey: 'up.steering.desc', maxLevel: 3, prices: [300, 700, 1350] },
  { id: 'seat', nameKey: 'up.seat', descKey: 'up.seat.desc', maxLevel: 3, prices: [340, 760, 1400] },
  { id: 'efficiency', nameKey: 'up.efficiency', descKey: 'up.efficiency.desc', maxLevel: 3, prices: [340, 780, 1450] },
  { id: 'turboCap', nameKey: 'up.turboCap', descKey: 'up.turboCap.desc', maxLevel: 3, prices: [380, 860, 1550] },
  { id: 'turboRecharge', nameKey: 'up.turboRecharge', descKey: 'up.turboRecharge.desc', maxLevel: 3, prices: [350, 800, 1480] },
  { id: 'canopy', nameKey: 'up.canopy', descKey: 'up.canopy.desc', maxLevel: 2, prices: [400, 950] },
  { id: 'sealedDrive', nameKey: 'up.sealedDrive', descKey: 'up.sealedDrive.desc', maxLevel: 2, prices: [420, 980], ridesRequired: 3 },
  { id: 'lights', nameKey: 'up.lights', descKey: 'up.lights.desc', maxLevel: 2, prices: [260, 640] },
];

export type CosmeticCategory = 'paint' | 'art' | 'tassel' | 'bell' | 'flowers' | 'mirror';

export interface CosmeticDef {
  id: string;
  category: CosmeticCategory;
  nameKey: string;
  price: number;
  /** Primary hex or art-pattern identifier consumed by the 3D builder. */
  value: string;
  /** Secondary swatch for the card chip. */
  swatch: [string, string];
}

export const COSMETICS: CosmeticDef[] = [
  { id: 'paint.red', category: 'paint', nameKey: 'cos.paint.red', price: 220, value: '#b8252f', swatch: ['#b8252f', '#f4c04a'] },
  { id: 'paint.blue', category: 'paint', nameKey: 'cos.paint.blue', price: 240, value: '#1e63b5', swatch: ['#1e63b5', '#b9ddff'] },
  { id: 'paint.green', category: 'paint', nameKey: 'cos.paint.green', price: 220, value: '#1a7a50', swatch: ['#1a7a50', '#f0cf70'] },
  { id: 'paint.gold', category: 'paint', nameKey: 'cos.paint.gold', price: 480, value: '#c98d24', swatch: ['#c98d24', '#fff0b2'] },
  { id: 'paint.teal', category: 'paint', nameKey: 'cos.paint.teal', price: 320, value: '#157c85', swatch: ['#157c85', '#ffd27a'] },
  { id: 'paint.magenta', category: 'paint', nameKey: 'cos.paint.magenta', price: 360, value: '#9d2463', swatch: ['#9d2463', '#ffd166'] },
  { id: 'paint.mango', category: 'paint', nameKey: 'cos.paint.mango', price: 300, value: '#d96b1f', swatch: ['#d96b1f', '#257a4a'] },

  { id: 'art.floral', category: 'art', nameKey: 'cos.art.floral', price: 300, value: 'floral', swatch: ['#e04646', '#f7d060'] },
  { id: 'art.bird', category: 'art', nameKey: 'cos.art.bird', price: 420, value: 'bird', swatch: ['#2485c7', '#f7b24a'] },
  { id: 'art.river', category: 'art', nameKey: 'cos.art.river', price: 460, value: 'river', swatch: ['#1f8c7a', '#f2d98d'] },
  { id: 'art.cinema', category: 'art', nameKey: 'cos.art.cinema', price: 620, value: 'cinema', swatch: ['#7d2e9e', '#ff8c52'] },
  { id: 'art.tiger', category: 'art', nameKey: 'cos.art.tiger', price: 540, value: 'tiger', swatch: ['#d97724', '#165b3a'] },

  { id: 'tassel.red', category: 'tassel', nameKey: 'cos.tassel.red', price: 120, value: '#d9323a', swatch: ['#d9323a', '#f5c258'] },
  { id: 'tassel.gold', category: 'tassel', nameKey: 'cos.tassel.gold', price: 160, value: '#e8b25a', swatch: ['#e8b25a', '#ffffff'] },
  { id: 'tassel.green', category: 'tassel', nameKey: 'cos.tassel.green', price: 140, value: '#2ca66b', swatch: ['#2ca66b', '#f5d47a'] },
  { id: 'tassel.cyan', category: 'tassel', nameKey: 'cos.tassel.cyan', price: 170, value: '#26b6d4', swatch: ['#26b6d4', '#ffd166'] },

  { id: 'bell.classic', category: 'bell', nameKey: 'cos.bell.classic', price: 0, value: 'classic', swatch: ['#c8c8c8', '#7a7a7a'] },
  { id: 'bell.brass', category: 'bell', nameKey: 'cos.bell.brass', price: 180, value: 'brass', swatch: ['#d9a03b', '#8f5d14'] },
  { id: 'bell.double', category: 'bell', nameKey: 'cos.bell.double', price: 260, value: 'double', swatch: ['#e8b25a', '#c94a3a'] },

  { id: 'flowers.marigold', category: 'flowers', nameKey: 'cos.flowers.marigold', price: 150, value: '#f59c24', swatch: ['#f59c24', '#ffd65c'] },
  { id: 'flowers.rose', category: 'flowers', nameKey: 'cos.flowers.rose', price: 200, value: '#d83a56', swatch: ['#d83a56', '#ff9db0'] },

  { id: 'mirror.round', category: 'mirror', nameKey: 'cos.mirror.round', price: 140, value: 'round', swatch: ['#cfd8df', '#5a6a78'] },
  { id: 'mirror.star', category: 'mirror', nameKey: 'cos.mirror.star', price: 240, value: 'star', swatch: ['#f5c258', '#d9323a'] },
];

export const DEFAULT_COSMETICS: Record<CosmeticCategory, string> = {
  paint: '',
  art: '',
  tassel: '',
  bell: 'bell.classic',
  flowers: '',
  mirror: '',
};

export interface TapeDef {
  id: string;
  nameKey: string;
  unlockRides: number;
}

export const TAPES: TapeDef[] = [
  { id: 'cassette', nameKey: 'tape.cassette', unlockRides: 0 },
  { id: 'radio', nameKey: 'tape.radio', unlockRides: 2 },
  { id: 'brishti', nameKey: 'tape.brishti', unlockRides: 6 },
];

export function vehicleById(id: string): VehicleDef {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

export function upgradeById(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export function cosmeticById(id: string): CosmeticDef | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export function cosmeticsByCategory(category: CosmeticCategory): CosmeticDef[] {
  return COSMETICS.filter((c) => c.category === category);
}
