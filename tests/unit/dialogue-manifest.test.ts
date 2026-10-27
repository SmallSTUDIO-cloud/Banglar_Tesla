import { describe, expect, it } from 'vitest';
import {
  DIALOGUE_LINES,
  INTRO_STINGS,
  allDialogueAssetPaths,
  dialogueLine,
  dialogueText,
  introStingForRival,
  ttsPitchRate,
  validateDialogueManifest,
} from '../../src/audio/dialogueManifest';

describe('Bangla dialogue manifest (vNext §3 — voice release gate)', () => {
  it('passes structural validation: unique ids, Bangla text, wav paths, voice params, 10-rival coverage', () => {
    const v = validateDialogueManifest();
    expect(v.issues, v.issues.join('; ')).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.lineCount).toBeGreaterThanOrEqual(38);
    expect(v.voicedBnCount).toBeGreaterThanOrEqual(38);
    expect(v.stingCount).toBe(10);
  });

  it('defines a non-empty wav path for every voiced line and every intro sting (file existence verified in E2E against the built bundle)', () => {
    for (const path of allDialogueAssetPaths()) {
      expect(path.endsWith('.wav')).toBe(true);
      expect(path.length).toBeGreaterThan('audio/'.length + 4);
    }
  });

  it('covers the mandatory audit checklist categories', () => {
    const categories = new Set(DIALOGUE_LINES.map((l) => l.category));
    for (const cat of [
      'blacklist',
      'police',
      'road_rage',
      'race',
      'mission',
      'garage',
      'rare_event',
      'gameplay',
      'vendor',
    ]) {
      expect(categories.has(cat as never), `missing category ${cat}`).toBe(true);
    }
  });

  it('gives every Blacklist rival an intro + taunt + distinct music sting', () => {
    for (const rivalId of [
      'bl_10_raju',
      'bl_09_sumon',
      'bl_08_tarek',
      'bl_07_nabila',
      'bl_06_halim',
      'bl_05_faisal',
      'bl_04_badol',
      'bl_03_sakib',
      'bl_02_ranga',
      'bl_01_samrat',
    ]) {
      const intro = dialogueLine(`rival.${rivalId}.intro`);
      const taunt = dialogueLine(`rival.${rivalId}.taunt`);
      expect(intro, rivalId).toBeTruthy();
      expect(taunt, rivalId).toBeTruthy();
      expect(intro!.wavBn).toContain(rivalId.split('_').pop()!); // e.g. bl_10_raju -> rival-raju-intro-bn.wav
      expect(intro!.wavEn).toBeTruthy();
      expect(intro!.bn).toMatch(/[\u0980-\u09FF]/); // real Bangla script, not phonetic-English
      expect(taunt!.bn).toMatch(/[\u0980-\u09FF]/);
      const sting = introStingForRival(rivalId);
      expect(sting, rivalId).toBeTruthy();
    }
  });

  it('keeps all ten rickshaw-puller voices tonally distinct (unique pitch/rate identity)', () => {
    const identities = new Set(
      DIALOGUE_LINES.filter((l) => l.character.startsWith('bl_') && l.id.endsWith('.intro')).map(
        (l) => `${l.voice.variant}|${l.voice.pitch}|${l.voice.rate}`,
      ),
    );
    expect(identities.size).toBeGreaterThanOrEqual(9);
  });

  it('never mixes English fallback text into Bangla lines and vice versa', () => {
    for (const line of DIALOGUE_LINES) {
      if (line.delivery !== 'voiced') continue;
      expect(line.bn, line.id).toMatch(/[\u0980-\u09FF]/);
      if (line.en) expect(line.en, line.id).not.toMatch(/[\u0980-\u09FF]/);
    }
  });

  it('keeps wav paths unique and inside the public/audio tree', () => {
    const paths = allDialogueAssetPaths();
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith('audio/')).toBe(true);
    }
  });

  it('maps espeak voice identity onto sane Web-TTS pitch/rate scales', () => {
    for (const line of DIALOGUE_LINES) {
      const tr = ttsPitchRate(line.voice);
      expect(tr.pitch).toBeGreaterThanOrEqual(0.5);
      expect(tr.pitch).toBeLessThanOrEqual(1.7);
      expect(tr.rate).toBeGreaterThanOrEqual(0.7);
      expect(tr.rate).toBeLessThanOrEqual(1.4);
    }
  });

  it('localizes both languages for every line and resolves lookup helpers', () => {
    for (const line of DIALOGUE_LINES) {
      expect(dialogueText(line.id, 'bn')).toBe(line.bn);
      expect(dialogueText(line.id, 'en')).toBe(line.en);
    }
    expect(dialogueLine('does.not.exist')).toBeUndefined();
  });

  it('writes 10 distinct sting wav files with varied musical roots', () => {
    expect(INTRO_STINGS.length).toBe(10);
    const roots = new Set(INTRO_STINGS.map((s) => s.root));
    expect(roots.size).toBeGreaterThanOrEqual(9);
  });
});
