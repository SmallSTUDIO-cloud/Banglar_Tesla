/**
 * Blacklist Entry & Per-Rival Character Intro Cinematics (v0.5.0 — Sections 10, 28, 32).
 *
 * Supports:
 *   1. `start(...)`: Original 18-second multi-shot Mohammadpur Blacklist intro
 *      played once on first entry into `রিকশা ব্ল্যাকলিস্ট` (persisted via
 *      `blacklistIntroSeen`), with manual replay from the Blacklist header.
 *   2. `startRivalIntro(rival, ...)`: Snappy 6.5-second per-rival character &
 *      custom rickshaw showcase framing that specific Blacklist rival's visible
 *      3D face, hair/headwear, outfit, handlebar grip, and voiced Bangla/English
 *      taunt before launching their boss race (or replaying their profile intro).
 *
 * Always skippable via `বাদ দিন / SKIP`, freezes simulation clock while active,
 * reuses the live Mohammadpur scene, and restores state with zero leaks!
 */

import * as THREE from 'three';
import { getLocale } from '../core/i18n';
import { clamp01, lerp } from '../core/mathx';
import { placeById } from '../world/layout';
import { BLACKLIST_RIVALS, type BlacklistRival } from './blacklistCatalog';
import { RickshawVisual } from '../vehicle/rickshawModel';
import { vehicleById } from '../economy/catalog';
import type { AudioEngine } from '../audio/audio';
import type { BanglaSpeechService } from '../audio/speech';

export interface CinematicUiState {
  active: boolean;
  shotIndex: number;
  headline: string;
  subline: string;
  rankBadge: string;
}

export class BlacklistIntroCinematic {
  private active = false;
  private mode: 'league' | 'rival' = 'league';
  private featuredRival: BlacklistRival | null = null;
  private elapsed = 0;
  private totalDuration = 18.0;
  private rivalActor: RickshawVisual | null = null;
  private bellPlayed = false;
  private tauntSpoken = false;
  private onCompleteCallback: (() => void) | null = null;

  private savedPlayerPos = { x: 0, y: 0, z: 0, yaw: 0 };
  private stageX = 0;
  private stageY = 0;
  private stageZ = 0;
  private stageYaw = 0;

  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly playerVisual: RickshawVisual,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly audio: AudioEngine,
    private readonly speech: BanglaSpeechService,
    private readonly getDialogueOpts: () => { volume: number; muted: boolean },
    private readonly onUiUpdate: (state: CinematicUiState) => void,
  ) {}

  get isPlaying(): boolean {
    return this.active;
  }

  get activeRival(): BlacklistRival | null {
    return this.featuredRival;
  }

  start(
    currentPlayerPose: { x: number; y: number; z: number; yaw: number },
    onComplete: () => void,
  ): void {
    const champ = BLACKLIST_RIVALS[BLACKLIST_RIVALS.length - 1]; // #1 Asad Gate-er Samrat
    this.beginSequence('league', champ, 18.0, currentPlayerPose, onComplete);
  }

  /** Play a skippable 6.5s character & rickshaw intro for a specific Blacklist rival (#10..#1). */
  startRivalIntro(
    rival: BlacklistRival,
    currentPlayerPose: { x: number; y: number; z: number; yaw: number },
    onComplete: () => void,
  ): void {
    this.beginSequence('rival', rival, 6.5, currentPlayerPose, onComplete);
  }

  private beginSequence(
    mode: 'league' | 'rival',
    rival: BlacklistRival,
    durationSec: number,
    currentPlayerPose: { x: number; y: number; z: number; yaw: number },
    onComplete: () => void,
  ): void {
    if (this.active) this.stop(false);

    this.mode = mode;
    this.featuredRival = rival;
    this.totalDuration = durationSec;
    this.savedPlayerPos = { ...currentPlayerPose };
    this.onCompleteCallback = onComplete;
    this.active = true;
    this.elapsed = 0;
    this.bellPlayed = false;
    this.tauntSpoken = false;

    const firstWp = rival.bossEvent.waypointPlaceIds[0];
    const stagePlace =
      (mode === 'rival' && firstWp ? placeById(firstWp) : null) ??
      placeById('bazaar') ??
      placeById('stand')!;
    this.stageX = stagePlace.x;
    this.stageZ = stagePlace.z;
    this.stageY = this.heightAt(this.stageX, this.stageZ);
    this.stageYaw = stagePlace.heading;

    const veh = rival.look.kind === 'electric' ? vehicleById('electric') : vehicleById('cinema');
    this.rivalActor = new RickshawVisual(veh, rival.look, false);
    this.rivalActor.root.position.set(this.stageX, this.stageY, this.stageZ);
    this.rivalActor.root.rotation.set(0, this.stageYaw, 0);
    this.rivalActor.setNightLighting(true, 1.0);
    this.rivalActor.setCharacterPose('intro', 0);
    this.scene.add(this.rivalActor.root);

    // Stage player rickshaw rolling up opposite the rival!
    const fx = Math.sin(this.stageYaw);
    const fz = Math.cos(this.stageYaw);
    this.playerVisual.root.position.set(
      this.stageX + fx * 6.8,
      this.heightAt(this.stageX + fx * 6.8, this.stageZ + fz * 6.8),
      this.stageZ + fz * 6.8,
    );
    this.playerVisual.root.rotation.set(0, this.stageYaw + Math.PI, 0);
    this.playerVisual.setCockpitVisibility(false);
    this.playerVisual.setCharacterPose('riding', 0);

    this.camera.fov = 48;
    this.camera.updateProjectionMatrix();
    this.update(0.016);
  }

  /** Skip or conclude immediately — cleans up rival mesh, speech, and restores player pose. */
  skip(): void {
    this.stop(true);
  }

  stop(invokeComplete = false): void {
    if (!this.active) return;
    this.active = false;
    this.featuredRival = null;
    this.speech.stop();

    if (this.rivalActor) {
      this.scene.remove(this.rivalActor.root);
      this.rivalActor.dispose();
      this.rivalActor = null;
    }

    this.playerVisual.setCharacterPose('riding', 0);
    this.playerVisual.root.position.set(
      this.savedPlayerPos.x,
      this.savedPlayerPos.y,
      this.savedPlayerPos.z,
    );
    this.playerVisual.root.rotation.set(0, this.savedPlayerPos.yaw, 0);

    this.onUiUpdate({
      active: false,
      shotIndex: 0,
      headline: '',
      subline: '',
      rankBadge: '',
    });

    const cb = this.onCompleteCallback;
    this.onCompleteCallback = null;
    if (invokeComplete && cb) cb();
  }

  update(dt: number): void {
    if (!this.active || !this.rivalActor || !this.featuredRival) return;
    this.elapsed += dt;
    if (this.elapsed >= this.totalDuration) {
      this.stop(true);
      return;
    }

    if (this.mode === 'rival') {
      this.updatePerRivalSequence(dt);
      return;
    }

    const t = this.elapsed;
    const loc = getLocale();
    const fx = Math.sin(this.stageYaw);
    const fz = Math.cos(this.stageYaw);
    const lx = fz;
    const lz = -fx;

    this.rivalActor.setCharacterPose('intro', t);
    this.rivalActor.updateVisual(
      dt,
      t < 5 ? 3.2 : 0.4,
      Math.sin(t * 1.4) * 0.14,
      0.3,
      0,
      this.stageY,
      0,
    );

    let shotIndex = 0;
    let headline = '';
    let subline = '';
    let rankBadge = '';

    if (t < 3.2) {
      // Shot 1: Atmospheric Mohammadpur evening street sweep
      shotIndex = 1;
      const u = clamp01(t / 3.2);
      this.camPos.set(
        this.stageX + lx * lerp(7.5, 4.2, u) + fx * lerp(8.5, 4.5, u),
        this.stageY + lerp(4.6, 2.4, u),
        this.stageZ + lz * lerp(7.5, 4.2, u) + fz * lerp(8.5, 4.5, u),
      );
      this.camLook.set(this.stageX, this.stageY + 1.35, this.stageZ);
      headline = loc === 'en' ? 'MOHAMMADPUR · AFTER DUSK' : 'মোহাম্মদপুর · সন্ধ্যার পর';
      subline =
        loc === 'en'
          ? 'When the bazaar shutters close, the fastest three-wheelers rule the avenues.'
          : 'দোকানের শাটার নামলেই আসাদ অ্যাভিনিউতে শুরু হয় আসল তিন চাকার রাজত্ব।';
    } else if (t < 6.4) {
      // Shot 2: Low close-up on spinning spoked wheel, brass bell & handlebar grip
      shotIndex = 2;
      if (!this.bellPlayed) {
        this.bellPlayed = true;
        this.audio.bell('double');
      }
      const u = clamp01((t - 3.2) / 3.2);
      this.camPos.set(
        this.stageX + lx * 1.45 + fx * lerp(-0.6, 0.95, u),
        this.stageY + lerp(0.56, 1.28, u),
        this.stageZ + lz * 1.45 + fz * lerp(-0.6, 0.95, u),
      );
      this.camLook.set(this.stageX + fx * 0.35, this.stageY + lerp(0.45, 1.22, u), this.stageZ + fz * 0.35);
      headline = loc === 'en' ? 'CUSTOM FRAMES · PURE GRIT' : 'কাস্টম রিকশা · দুর্দান্ত গতি';
      subline =
        loc === 'en'
          ? 'Ten street legends stand between your classic rickshaw and the #1 crown.'
          : 'দশজন সেরা ওস্তাদকে হারালেই মিলবে মোহাম্মদপুরের এক নম্বর মুকুট!';
    } else if (t < 11.6) {
      // Shot 3: #1 Rival character portrait reveal + voiced Bangla/English taunt!
      shotIndex = 3;
      if (!this.tauntSpoken) {
        this.tauntSpoken = true;
        const dlg = this.getDialogueOpts();
        const tauntText =
          loc === 'en'
            ? "Mohammadpur's streets belong to me tonight! Catch me if you can!"
            : 'মোহাম্মদপুরের রাস্তা আজ আমার দখলে! পারলে ধরে দেখা!';
        this.speech.speak({
          speaker: 'rival',
          text: tauntText,
          locale: loc,
          priority: 3,
          volume: dlg.volume,
          muted: dlg.muted,
        });
      }
      const u = clamp01((t - 6.4) / 5.2);
      this.camPos.set(
        this.stageX + fx * lerp(2.1, 2.9, u) - lx * lerp(1.15, 0.55, u),
        this.stageY + lerp(1.52, 1.66, u),
        this.stageZ + fz * lerp(2.1, 2.9, u) - lz * lerp(1.15, 0.55, u),
      );
      this.camLook.set(this.stageX + fx * 0.14, this.stageY + 1.48, this.stageZ + fz * 0.14);
      rankBadge = loc === 'en' ? '#1 · Asad Gate-er Samrat' : '#১ · আসাদ গেটের সম্রাট';
      headline = loc === 'en' ? 'ASAD GATE-ER SAMRAT (#1)' : 'আসাদ গেটের সম্রাট (#১)';
      subline =
        loc === 'en'
          ? '"Mohammadpur\'s streets belong to me tonight! Catch me if you can!"'
          : '“মোহাম্মদপুরের রাস্তা আজ আমার দখলে! পারলে ধরে দেখা!”';
    } else if (t < 15.0) {
      // Shot 4: Player rickshaw rolls forward into challenge stance
      shotIndex = 4;
      const u = clamp01((t - 11.6) / 3.4);
      const pDist = lerp(6.8, 4.3, u);
      const px = this.stageX + fx * pDist;
      const pz = this.stageZ + fz * pDist;
      const py = this.heightAt(px, pz);
      this.playerVisual.root.position.set(px, py, pz);
      this.playerVisual.updateVisual(dt, 2.2 * (1 - u), 0, 0.4, 0, py, 0);

      this.camPos.set(
        this.stageX + fx * 2.1 + lx * 3.8,
        this.stageY + 1.65,
        this.stageZ + fz * 2.1 + lz * 3.8,
      );
      this.camLook.set(this.stageX + fx * 2.1, this.stageY + 1.25, this.stageZ + fz * 2.1);
      headline = loc === 'en' ? 'START FROM #10 · RISE TO #1' : '#১০ থেকে শুরু · লক্ষ্য #১ চ্যাম্পিয়ন';
      subline =
        loc === 'en'
          ? 'Outrun 3 street rivals per race, earn REP, and defeat all 10 Blacklist bosses.'
          : 'প্রতি রেসে ৩ জন প্রতিদ্বন্দ্বীকে হারান, REP অর্জন করুন আর ১০ জন বসকে জয় করুন!';
    } else {
      // Shot 5: High dramatic Blacklist #10 -> #1 challenge title card
      shotIndex = 5;
      const u = clamp01((t - 15.0) / 3.0);
      this.camPos.set(
        this.stageX + lx * lerp(4.2, 5.8, u) + fx * 2.1,
        this.stageY + lerp(2.1, 3.6, u),
        this.stageZ + lz * lerp(4.2, 5.8, u) + fz * 2.1,
      );
      this.camLook.set(this.stageX + fx * 1.8, this.stageY + 1.25, this.stageZ + fz * 1.8);
      rankBadge = '#10 → #1';
      headline = loc === 'en' ? 'RICKSHAW BLACKLIST' : 'রিকশা ব্ল্যাকলিস্ট';
      subline =
        loc === 'en'
          ? 'Challenge #10 Kana Galir Raju now!'
          : 'এখনই #১০ কানা গলির রাজুকে চ্যালেঞ্জ জানান!';
    }

    this.camera.position.copy(this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);

    this.onUiUpdate({
      active: true,
      shotIndex,
      headline,
      subline,
      rankBadge,
    });
  }

  private updatePerRivalSequence(dt: number): void {
    const rival = this.featuredRival!;
    const actor = this.rivalActor!;
    const t = this.elapsed;
    const loc = getLocale();
    const fx = Math.sin(this.stageYaw);
    const fz = Math.cos(this.stageYaw);
    const lx = fz;
    const lz = -fx;

    actor.setCharacterPose('intro', t);
    actor.updateVisual(dt, t < 2.0 ? 2.4 : 0.3, Math.sin(t * 2.1) * 0.16, 0.35, 0, this.stageY, 0);

    const name = loc === 'en' ? rival.nameEn : rival.nameBn;
    const arch = loc === 'en' ? rival.archetypeEn : rival.archetypeBn;
    const terr = loc === 'en' ? rival.territoryEn : rival.territoryBn;
    const taunt = loc === 'en' ? rival.tauntEn : rival.tauntBn;
    const badge = `#${rival.rank} · ${arch}`;

    let shotIndex = 1;
    let subline = terr;

    if (t < 2.1) {
      // Shot 1: Low hero sweep from custom rickshaw art & spoked wheel up to handlebar
      shotIndex = 1;
      if (!this.bellPlayed) {
        this.bellPlayed = true;
        this.audio.bell(rival.look.bell === 'double' ? 'double' : 'brass');
      }
      const u = clamp01(t / 2.1);
      this.camPos.set(
        this.stageX + lx * lerp(2.2, 1.5, u) + fx * lerp(-1.2, 1.1, u),
        this.stageY + lerp(0.75, 1.38, u),
        this.stageZ + lz * lerp(2.2, 1.5, u) + fz * lerp(-1.2, 1.1, u),
      );
      this.camLook.set(this.stageX + fx * 0.15, this.stageY + lerp(0.85, 1.38, u), this.stageZ + fz * 0.15);
      subline = terr;
    } else if (t < 4.7) {
      // Shot 2: Tight character face, headwear, outfit & handlebar grip framing + voiced taunt!
      shotIndex = 2;
      if (!this.tauntSpoken) {
        this.tauntSpoken = true;
        const dlg = this.getDialogueOpts();
        this.speech.speak({
          speaker: 'rival',
          text: taunt,
          locale: loc,
          priority: 3,
          volume: dlg.volume,
          muted: dlg.muted,
        });
      }
      const u = clamp01((t - 2.1) / 2.6);
      this.camPos.set(
        this.stageX + fx * lerp(1.95, 2.45, u) - lx * lerp(0.95, 0.45, u),
        this.stageY + lerp(1.50, 1.62, u),
        this.stageZ + fz * lerp(1.95, 2.45, u) - lz * lerp(0.95, 0.45, u),
      );
      this.camLook.set(this.stageX + fx * 0.14, this.stageY + 1.48, this.stageZ + fz * 0.14);
      subline = loc === 'en' ? `"${taunt}"` : `“${taunt}”`;
    } else {
      // Shot 3: Wide face-off framing both challenger & boss rickshaw before grid launch
      shotIndex = 3;
      const u = clamp01((t - 4.7) / 1.8);
      this.camPos.set(
        this.stageX + lx * lerp(3.4, 4.4, u) + fx * 2.2,
        this.stageY + lerp(1.75, 2.35, u),
        this.stageZ + lz * lerp(3.4, 4.4, u) + fz * 2.2,
      );
      this.camLook.set(this.stageX + fx * 1.6, this.stageY + 1.25, this.stageZ + fz * 1.6);
      subline = loc === 'en' ? rival.bossEvent.titleEn : rival.bossEvent.titleBn;
    }

    this.camera.position.copy(this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);

    this.onUiUpdate({
      active: true,
      shotIndex,
      headline: name,
      subline,
      rankBadge: badge,
    });
  }
}
