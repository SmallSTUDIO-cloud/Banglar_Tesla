import { describe, it, expect } from 'vitest';
import { CAMERA_MODES } from '../../src/core/config';
import { COSMETICS, UPGRADES, VEHICLES } from '../../src/economy/catalog';
import { STRINGS, translate, t, setLocale, getLocale, hasString } from '../../src/core/i18n';

const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/g;

describe('localisation', () => {
  it('has both Bangla and English for every key', () => {
    for (const [key, entry] of Object.entries(STRINGS)) {
      expect(entry.bn.length, `${key} bn`).toBeGreaterThan(0);
      expect(entry.en.length, `${key} en`).toBeGreaterThan(0);
    }
  });

  it('uses Bangla script (not latin transliteration) for Bangla strings', () => {
    const bengali = /[\u0980-\u09FF]/;
    let withScript = 0;
    for (const entry of Object.values(STRINGS)) {
      if (bengali.test(entry.bn)) withScript++;
    }
    // the vast majority of Bangla strings must be real Bangla script
    expect(withScript / Object.keys(STRINGS).length).toBeGreaterThan(0.9);
  });

  it('keeps placeholder sets identical between languages', () => {
    for (const [key, entry] of Object.entries(STRINGS)) {
      const bn = (entry.bn.match(PLACEHOLDER) ?? []).sort().join(',');
      const en = (entry.en.match(PLACEHOLDER) ?? []).sort().join(',');
      expect(bn, `placeholder mismatch in ${key}`).toBe(en);
    }
  });

  it('interpolates parameters', () => {
    expect(translate('en', 'common.needMore', { n: '৳40' })).toContain('৳40');
    expect(translate('bn', 'common.needMore', { n: '৳40' })).toContain('৳40');
  });

  it('falls back to the key when a string is missing', () => {
    expect(translate('bn', 'does.not.exist')).toBe('does.not.exist');
    expect(hasString('does.not.exist')).toBe(false);
    expect(hasString('common.play')).toBe(true);
  });

  it('switches the active locale', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('common.play')).toBe('Play');
    setLocale('bn');
    expect(t('common.play')).toBe('খেলা শুরু');
  });

  it('rejects an invalid locale instead of corrupting state', () => {
    setLocale('bn');
    setLocale('fr' as never);
    expect(getLocale()).toBe('bn');
  });

  it('uses the taka symbol, never the dollar sign', () => {
    for (const entry of Object.values(STRINGS)) {
      expect(entry.bn.includes('$')).toBe(false);
      expect(entry.en.includes('$')).toBe(false);
    }
  });

  it('contains no obviously corrupted Bangla (replacement chars / ISO escapes)', () => {
    for (const [key, entry] of Object.entries(STRINGS)) {
      expect(entry.bn.includes('\uFFFD'), key).toBe(false);
      expect(entry.bn.includes('\\u'), key).toBe(false);
      expect(entry.bn.includes('????'), key).toBe(false);
    }
  });

  it('defines all camera modes, vehicles, upgrades, cosmetics, Dokan, and OSM keys', () => {
    for (const mode of CAMERA_MODES) {
      expect(hasString(`cam.mode.${mode}`), `cam.mode.${mode}`).toBe(true);
      expect(hasString(`cam.short.${mode}`), `cam.short.${mode}`).toBe(true);
    }
    for (const v of VEHICLES) {
      expect(hasString(v.nameKey), v.nameKey).toBe(true);
      expect(hasString(v.descKey), v.descKey).toBe(true);
    }
    for (const u of UPGRADES) {
      expect(hasString(u.nameKey), u.nameKey).toBe(true);
      expect(hasString(u.descKey), u.descKey).toBe(true);
    }
    for (const c of COSMETICS) {
      expect(hasString(c.nameKey), c.nameKey).toBe(true);
    }
    for (const k of ['cam.switched', 'garage.stat.accel', 'store.comingSoon', 'store.comingSoonSub', 'osm.credit']) {
      expect(hasString(k), k).toBe(true);
    }
  });
});
