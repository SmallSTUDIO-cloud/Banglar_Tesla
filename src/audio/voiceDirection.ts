import { clamp } from '../core/mathx';

/** Stable per-character direction. Expressive TTS depends on installed voices;
 * these bounded settings do not impersonate human recordings. */
export function identityIndex(id: string, count: number): number {
  if (count <= 1) return 0;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % count;
}

export function voiceDirection(character: string, emotion: string, pitch: number, rate: number): { pitch: number; rate: number } {
  const mood: Record<string, [number, number]> = {
    calm: [-.035, -.055], friendly: [.025, -.025], welcoming: [.025, -.04],
    playful: [.045, .045], excited: [.06, .07], startled: [.075, .075],
    surprised: [.05, .07], angry: [-.05, .075], fierce: [-.055, .065],
    warning: [-.04, -.02], command: [-.06, -.025], dramatic: [-.035, -.07],
    triumphant: [.035, -.02], agreeing: [.015, -.025], declining: [-.035, -.055],
  };
  const [p, r] = mood[emotion] ?? [0, 0];
  const tint = identityIndex(character, 13) - 6;
  return { pitch: clamp(pitch + p + tint * .006, .65, 1.5),
    rate: clamp(rate + r + tint * .002, .75, 1.32) };
}
