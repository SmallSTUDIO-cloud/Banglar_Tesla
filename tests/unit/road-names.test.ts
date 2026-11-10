/**
 * Decision B (2026-10-29): "Babor Road" is the canonical displayed spelling,
 * "Babar Road" stays a recognised alias, and **no identifier changes**.
 *
 * The identifier half is the important half: a well-meaning future rename of
 * `babar_1` or the `place.bridge` i18n key would break saves, race references
 * and localisation for a cosmetic spelling change. These tests pin that.
 */

import { describe, expect, it } from 'vitest';
import { MOHAMMADPUR_EDGES, MOHAMMADPUR_NODES } from '../../src/world/mohammadpurData';
import { canonicalRoadName, roadNameMatches, normalizeRoadName } from '../../src/world/roadNames';
import { STRINGS } from '../../src/core/i18n';

describe('Babor / Babar road naming', () => {
  it('displays the canonical OSM spelling "Babor Road"', () => {
    const babarSegments = MOHAMMADPUR_EDGES.filter((e) => e.id.startsWith('babar_') && e.nameEn.includes('Road'));
    expect(babarSegments.length).toBeGreaterThan(0);
    for (const e of babarSegments) {
      expect(e.nameEn).toContain('Babor');
      expect(e.nameEn).not.toContain('Babar');
    }
  });

  it('keeps every legacy identifier exactly as it was', () => {
    // Segment ids
    for (const id of ['babar_0', 'babar_1', 'babar_2', 'babar_3', 'babar_deadend', 'babar_link_e']) {
      expect(MOHAMMADPUR_EDGES.some((e) => e.id === id), `missing segment id ${id}`).toBe(true);
    }
    // Node ids
    for (const id of ['babar_w', 'babar_mid', 'babar_humayun', 'babar_e']) {
      expect(MOHAMMADPUR_NODES.some((n) => n.id === id), `missing node id ${id}`).toBe(true);
    }
  });

  it('keeps the localisation key and its Bengali text', () => {
    const bridge = STRINGS['place.bridge'];
    expect(bridge).toBeDefined();
    expect(bridge.bn).toBe('বাবর রোড জহুরি মহল্লা');
    expect(bridge.en).toContain('Babor');
  });

  it('treats "Babar Road" as an accepted alias of "Babor Road"', () => {
    expect(roadNameMatches('Babar Road', 'Babor Road')).toBe(true);
    expect(roadNameMatches('babor road', 'Babor Road')).toBe(true);
    expect(roadNameMatches('BABOR   ROAD', 'Babor Road')).toBe(true);
    expect(canonicalRoadName('Babar Road')).toBe('Babor Road');
    expect(canonicalRoadName('Babor Road')).toBe('Babor Road');
  });

  it('does not match unrelated names', () => {
    expect(roadNameMatches('Babar', 'Babor Road')).toBe(false);
    expect(roadNameMatches('Ring Road', 'Babor Road')).toBe(false);
    expect(roadNameMatches('', 'Babor Road')).toBe(false);
    expect(canonicalRoadName('Humayun Road')).toBeNull();
  });

  it('normalises punctuation but leaves Bangla intact', () => {
    expect(normalizeRoadName('Babor-Road.')).toBe('babor road');
    expect(normalizeRoadName('  Mirror   Road ')).toBe('mirror road');
    expect(normalizeRoadName('বাবর রোড')).toBe('বাবর রোড');
  });
});
