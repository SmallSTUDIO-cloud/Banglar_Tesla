/**
 * Dialogue manifest (Master Upgrade vNext §3) — the single source of truth for
 * every intended spoken line in Banglar Tesla.
 *
 * Backing data: `dialogueManifest.json` (shared with `scripts/gen-audio-assets.py`
 * so the offline WAV synthesizer renders exactly the same texts/voices).
 *
 * QA honesty policy: bundled per-line WAVs are synthesized offline with
 * `libespeak-ng` (Bengali voice, manual hasant/ZWNJ grapheme shaping, per-character
 * pitch/rate identity). These are phonetic synthetic Bengali renderings, NOT
 * human recordings; every entry carries that QA status and a physical-device
 * intelligibility and listening sign-off is still required before release sign-off. Where a verified
 * native `bn-*` system TTS voice exists on device it speaks the exact manifest
 * text instead (checked by `BanglaSpeechService`).
 */

import rawManifest from './dialogueManifest.json';

export type DialogueCategory =
  | 'blacklist'
  | 'police'
  | 'road_rage'
  | 'race'
  | 'mission'
  | 'garage'
  | 'rare_event'
  | 'gameplay'
  | 'vendor';

export type DialogueDelivery = 'voiced' | 'text-only' | 'ambience';

export interface DialogueVoiceSpec {
  variant: string;
  pitch: number;
  rate: number;
  range: number;
}

export interface DialogueLine {
  id: string;
  category: DialogueCategory;
  character: string;
  emotion: string;
  delivery: DialogueDelivery;
  bn: string;
  en: string;
  wavBn: string;
  wavEn: string;
  radio?: boolean;
  voice: DialogueVoiceSpec;
  voiceEn?: DialogueVoiceSpec;
  /** QA status — honest about the synthesized fallback source. */
  qa?: string;
}

export interface IntroSting {
  id: string;
  rivalId: string;
  wav: string;
  root: number;
  tempo: number;
  drift: number;
}

interface ManifestShape {
  version: number;
  notes: string;
  lines: DialogueLine[];
  stings: IntroSting[];
}

const manifest = rawManifest as ManifestShape;

export const DIALOGUE_MANIFEST_VERSION = manifest.version;
export const DIALOGUE_LINES: readonly DialogueLine[] = manifest.lines;
export const INTRO_STINGS: readonly IntroSting[] = manifest.stings;

const lineById = new Map<string, DialogueLine>(DIALOGUE_LINES.map((l) => [l.id, l]));
const stingByRival = new Map<string, IntroSting>(INTRO_STINGS.map((s) => [s.rivalId, s]));

export function dialogueLine(id: string): DialogueLine | undefined {
  return lineById.get(id);
}

/** Localized subtitle text for a manifest line (Bangla-first). */
export function dialogueText(id: string, locale: 'bn' | 'en'): string | undefined {
  const line = lineById.get(id);
  if (!line) return undefined;
  return locale === 'en' ? line.en : line.bn;
}

export function introStingForRival(rivalId: string): IntroSting | undefined {
  return stingByRival.get(rivalId);
}

/** Manifest lines in canonical rendering order (used by the offline generator). */
export function allDialogueLines(): readonly DialogueLine[] {
  return DIALOGUE_LINES;
}

export interface ManifestValidation {
  ok: boolean;
  issues: string[];
  lineCount: number;
  voicedBnCount: number;
  voicedEnCount: number;
  stingCount: number;
}

/**
 * Pure validation used by unit tests and the generator:
 * unique ids, non-empty Bangla text for every voiced line, wav path presence,
 * valid voice params, and coverage of all ten Blacklist rivals (intro + taunt).
 */
export function validateDialogueManifest(): ManifestValidation {
  const issues: string[] = [];
  const seen = new Set<string>();
  let voicedBn = 0;
  let voicedEn = 0;
  for (const line of DIALOGUE_LINES) {
    if (seen.has(line.id)) issues.push(`duplicate id: ${line.id}`);
    seen.add(line.id);
    if (line.delivery === 'voiced') {
      if (!line.bn || line.bn.trim().length < 2) issues.push(`missing Bangla text: ${line.id}`);
      if (!line.wavBn) issues.push(`missing Bangla wav path: ${line.id}`);
      else voicedBn++;
      if (line.wavEn) voicedEn++;
      const v = line.voice;
      if (!v || !v.variant || v.pitch < 0 || v.pitch > 99 || v.rate < 60 || v.rate > 220) {
        issues.push(`bad voice params: ${line.id}`);
      }
    }
    if (line.delivery === 'text-only' && !line.bn) issues.push(`missing text: ${line.id}`);
  }
  for (const sting of INTRO_STINGS) {
    if (!sting.wav) issues.push(`sting missing wav: ${sting.id}`);
  }
  // All ten Blacklist rivals must have intro + taunt coverage
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
    if (!lineById.has(`rival.${rivalId}.intro`)) issues.push(`missing intro line: ${rivalId}`);
    if (!lineById.has(`rival.${rivalId}.taunt`)) issues.push(`missing taunt line: ${rivalId}`);
    if (!stingByRival.has(rivalId)) issues.push(`missing intro sting: ${rivalId}`);
  }
  return {
    ok: issues.length === 0,
    issues,
    lineCount: DIALOGUE_LINES.length,
    voicedBnCount: voicedBn,
    voicedEnCount: voicedEn,
    stingCount: INTRO_STINGS.length,
  };
}

/** Every `wavBn`/`wavEn`/sting path the web bundle must ship. */
export function allDialogueAssetPaths(): string[] {
  const out: string[] = [];
  for (const line of DIALOGUE_LINES) {
    if (line.wavBn) out.push(line.wavBn);
    if (line.wavEn) out.push(line.wavEn);
  }
  for (const sting of INTRO_STINGS) out.push(sting.wav);
  return out;
}

/**
 * Map an espeak-style voice spec (pitch/rate 0..99 & 60..220) onto Web-Speech
 * `Utterance` scales (pitch 0..2, rate 0.1..2) so character identity survives
 * whichever backend speaks the line.
 */
export function ttsPitchRate(v: DialogueVoiceSpec | undefined): { pitch: number; rate: number } {
  if (!v) return { pitch: 1, rate: 1 };
  const pitch = Math.max(0.55, Math.min(1.65, 0.62 + ((v.pitch - 26) / 73) * 1.03));
  const rate = Math.max(0.72, Math.min(1.32, 0.68 + ((v.rate - 142) / 38) * 0.62));
  return { pitch, rate };
}
