/**
 * Mission runtime: offers, pickup/drop-off zones, passenger boarding, mood and
 * the final fare breakdown. Renders world-space markers and manages passenger
 * actor lifecycles with deterministic zero-leak cleanup.
 */

import * as THREE from 'three';
import { MISSION } from '../core/config';
import { Emitter } from '../core/events';
import { clamp, clamp01 } from '../core/mathx';
import { computeFare, type FareBreakdown } from '../economy/economy';
import { isClearOfRoads, placeById, segmentById, type PlaceDef } from '../world/layout';
import { releaseScratchCanvas } from '../world/textures';
import { PassengerActor, archetypeById } from './actors';
import type { MissionOffer } from './mission';

export type MissionState = 'none' | 'toPickup' | 'boarding' | 'toDropoff' | 'arrived' | 'complete';

export interface MissionEvents {
  started: MissionOffer;
  boarded: MissionOffer;
  completed: { offer: MissionOffer; fare: FareBreakdown; distance: number; time: number; mood: number };
  dialogue: { key: string; who: string; side: 'who' | 'rider' };
  hint: string | null;
  mood: number;
}

export interface MissionHost {
  scene: THREE.Scene;
  rickshaw: THREE.Object3D;
  seatAnchor: THREE.Object3D;
  playerX: () => number;
  playerZ: () => number;
  playerSpeed: () => number;
  wet: boolean;
}

function markerTexture(color: string, glyph: string): THREE.DataTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 56, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(44, 82);
  ctx.lineTo(64, 118);
  ctx.lineTo(84, 82);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0b1512';
  ctx.font = '700 46px "Hind Siliguri", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 64, 58);
  const img = ctx.getImageData(0, 0, 128, 128);
  canvas.width = 1;
  canvas.height = 1;
  releaseScratchCanvas();
  const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer), 128, 128, THREE.RGBAFormat);
  tex.flipY = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class MissionSystem extends Emitter<MissionEvents> {
  state: MissionState = 'none';
  offer: MissionOffer | null = null;
  passenger: PassengerActor | null = null;
  mood: number = MISSION.moodStart;
  elapsed = 0;
  boardedAt = 0;
  distance = 0;
  detourBonusEarned = false;

  private host: MissionHost;
  private pickup: PlaceDef | null = null;
  private drop: PlaceDef | null = null;
  private markerGroup = new THREE.Group();
  private beacon: THREE.Mesh;
  private ring: THREE.Mesh;
  private sprite: THREE.Sprite;
  private markerLabel: 'pickup' | 'drop' = 'pickup';
  private boardingTimer = 0;
  private lastHint: string | null = null;
  private pickupTexture = markerTexture('#4cd6a0', '↑');
  private dropTexture = markerTexture('#e8b25a', '↓');
  private poseTimer = 0;
  private leavingActors: { actor: PassengerActor; ttl: number }[] = [];
  private markerWorldOut = new THREE.Vector3();

  constructor(host: MissionHost) {
    super();
    this.host = host;

    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x4cd6a0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 8, 18, 1, true), beaconMat);
    this.beacon.position.y = 4;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.7, 2.15, 28),
      new THREE.MeshBasicMaterial({ color: 0x4cd6a0, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.pickupTexture, transparent: true, depthWrite: false }),
    );
    this.sprite.scale.set(1.5, 1.5, 1);
    this.sprite.position.y = 4.4;
    this.markerGroup.add(this.beacon, this.ring, this.sprite);
    this.markerGroup.visible = false;
    this.host.scene.add(this.markerGroup);
  }

  get moodRatio(): number {
    return clamp01(this.mood / 100);
  }

  get zone(): PlaceDef | null {
    return this.state === 'toPickup' || this.state === 'boarding' ? this.pickup : this.drop;
  }

  get activeMarkerWorld(): THREE.Vector3 | null {
    if (!this.markerGroup.visible) return null;
    return this.markerWorldOut.set(
      this.markerGroup.position.x,
      this.markerGroup.position.y + 2.2,
      this.markerGroup.position.z,
    );
  }

  private safeSidewalkSpotNear(place: PlaceDef): { x: number; z: number; yaw: number } {
    const seg = segmentById(place.segmentId);
    if (seg) {
      for (const side of [1, -1] as const) {
        const sx = place.x + seg.leftX * (seg.halfWidth * 0.55 + 1.4) * side;
        const sz = place.z + seg.leftZ * (seg.halfWidth * 0.55 + 1.4) * side;
        if (isClearOfRoads(sx, sz, 0.35)) {
          return { x: sx, z: sz, yaw: Math.atan2(place.x - sx, place.z - sz) };
        }
      }
    }
    return { x: place.x + 2.2, z: place.z + 1.2, yaw: 0 };
  }

  start(offer: MissionOffer): void {
    this.clearPassenger();
    this.flushLeavingActors();
    this.offer = offer;
    this.pickup = placeById(offer.pickupId) ?? null;
    this.drop = placeById(offer.dropId) ?? null;
    this.state = 'toPickup';
    this.mood = clamp(MISSION.moodStart + archetypeById(offer.archetype).moodBias, 40, 100);
    this.elapsed = 0;
    this.distance = 0;
    this.boardingTimer = 0;
    this.detourBonusEarned = false;

    if (this.pickup) {
      const waitSpot = this.safeSidewalkSpotNear(this.pickup);
      const actor = new PassengerActor(archetypeById(offer.archetype));
      actor.place(waitSpot.x, waitSpot.z, waitSpot.yaw);
      this.host.scene.add(actor.group);
      this.passenger = actor;
      this.setMarker(this.pickup, 'pickup');
      this.emit('hint', 'hud.hintPickup');
      this.lastHint = 'hud.hintPickup';
      this.emit('dialogue', {
        key: archetypeById(offer.archetype).greetKey,
        who: archetypeById(offer.archetype).whoKey,
        side: 'who',
      });
    }
    this.emit('mood', this.mood);
    this.emit('started', offer);
  }

  private setMarker(place: PlaceDef, kind: 'pickup' | 'drop'): void {
    this.markerLabel = kind;
    const color = kind === 'pickup' ? 0x4cd6a0 : 0xe8b25a;
    this.markerGroup.position.set(place.x, 0, place.z);
    (this.beacon.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.sprite.material.map = kind === 'pickup' ? this.pickupTexture : this.dropTexture;
    this.sprite.material.needsUpdate = true;
    this.markerGroup.visible = true;
  }

  private flushLeavingActors(): void {
    while (this.leavingActors.length > 0) {
      const item = this.leavingActors.pop()!;
      item.actor.dispose();
    }
  }

  private clearPassenger(): void {
    if (this.passenger) {
      this.passenger.dispose();
      this.passenger = null;
    }
    this.markerGroup.visible = false;
    this.offer = null;
    this.state = 'none';
  }

  cancel(): void {
    this.clearPassenger();
    this.flushLeavingActors();
    this.emit('hint', null);
    this.lastHint = null;
  }

  registerImpact(strength: number): void {
    if (this.state !== 'toDropoff' && this.state !== 'toPickup') return;
    if (strength < 0.5) return;
    const penalty = MISSION.moodCollisionHit * clamp(strength / 2.2, 0.4, 1.6);
    this.mood = clamp(this.mood - penalty, 0, 100);
    this.emit('mood', this.mood);
    if (Math.random() < 0.45) {
      this.emit('dialogue', {
        key: 'd.annoyed',
        who: archetypeById(this.offer?.archetype ?? 'student').whoKey,
        side: 'who',
      });
    }
  }

  registerHardBrake(): void {
    if (this.state !== 'toDropoff') return;
    this.mood = clamp(this.mood - MISSION.moodHardBrake, 0, 100);
    this.emit('mood', this.mood);
  }

  private hint(key: string | null): void {
    if (this.lastHint === key) return;
    this.lastHint = key;
    this.emit('hint', key);
  }

  update(dt: number, speed: number): void {
    // Deterministically tick & dispose departing passengers using simulation dt!
    for (let i = this.leavingActors.length - 1; i >= 0; i--) {
      const entry = this.leavingActors[i];
      entry.actor.update(dt);
      entry.ttl -= dt;
      if (entry.ttl <= 0) {
        entry.actor.dispose();
        this.leavingActors.splice(i, 1);
      }
    }

    if (this.state === 'none') return;
    this.elapsed += dt;

    const nowSec = performance.now() * 0.001;
    const pulse = 0.5 + Math.sin(nowSec * 3.1) * 0.5;
    const playerDist = Math.hypot(
      this.host.playerX() - this.markerGroup.position.x,
      this.host.playerZ() - this.markerGroup.position.z,
    );
    const inside = clamp01((playerDist - 2.0) / 6.0);
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = (0.1 + pulse * 0.1) * inside;
    this.beacon.visible = inside > 0.02;
    this.beacon.scale.setScalar(1 + pulse * 0.05);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + pulse * 0.35;
    this.ring.scale.setScalar(1 + pulse * 0.08);
    this.sprite.position.y = 4.2 + Math.sin(nowSec * 2.2) * 0.16;

    const px = this.host.playerX();
    const pz = this.host.playerZ();
    this.passenger?.update(dt);

    if (this.state === 'toPickup' && this.pickup) {
      const dist = Math.hypot(px - this.pickup.x, pz - this.pickup.z);
      this.hint('hud.hintPickup');
      if (dist < MISSION.acceptRadius && Math.abs(speed) < MISSION.pickupStopSpeed) {
        this.state = 'boarding';
        this.boardingTimer = 0;
        const targetX = px + 0.9;
        const targetZ = pz;
        this.passenger?.walkTo(targetX, targetZ, () => {
          if (!this.passenger) return;
          this.passenger.seat(this.host.seatAnchor);
          this.state = 'toDropoff';
          this.boardedAt = this.elapsed;
          if (this.drop) this.setMarker(this.drop, 'drop');
          this.emit('boarded', this.offer!);
          this.emit('dialogue', {
            key: 'd.enter',
            who: archetypeById(this.offer!.archetype).whoKey,
            side: 'who',
          });
          this.emit('hint', 'hud.hintDrop');
        });
      }
    } else if (this.state === 'boarding') {
      this.boardingTimer += dt;
      if (this.boardingTimer > 3.8) {
        this.passenger?.seat(this.host.seatAnchor);
        this.state = 'toDropoff';
        this.boardedAt = this.elapsed;
        if (this.drop) this.setMarker(this.drop, 'drop');
        this.emit('boarded', this.offer!);
        this.emit('hint', 'hud.hintDrop');
      }
    } else if (this.state === 'toDropoff' && this.drop) {
      const dist = Math.hypot(px - this.drop.x, pz - this.drop.z);
      this.distance = Math.max(0, this.offer?.distance ?? this.distance);
      if (dist < MISSION.dropRadius && Math.abs(speed) < MISSION.dropStopSpeed) {
        this.completeRide();
      }
      this.poseTimer += dt;
      if (this.poseTimer > 26 && Math.random() < 0.5) {
        this.poseTimer = 0;
        const key = this.mood > 78 ? 'd.midroute' : this.mood > 45 ? 'd.lane' : 'd.annoyed';
        this.emit('dialogue', {
          key,
          who: archetypeById(this.offer!.archetype).whoKey,
          side: 'who',
        });
      }
      if (Math.abs(speed) > 0.6) {
        this.mood = clamp(this.mood + MISSION.moodSmoothGainPerSecond * dt, 0, 100);
        this.emit('mood', this.mood);
      }
    }
  }

  private completeRide(): void {
    if (!this.offer || !this.drop) return;
    const t = this.elapsed - this.boardedAt;
    const trafficBonus =
      (this.detourBonusEarned ? 20 : 0) + (this.offer.kind === 'market' ? 15 : 0);
    const fare = computeFare({
      distance: this.offer.distance,
      timeTaken: t,
      targetTime: this.offer.targetTime,
      mood: this.mood,
      damage: 0,
      fareMultiplier: this.offer.multiplier,
      trafficBonus,
    });
    const offer = this.offer;
    const mood = this.mood;
    const distance = this.offer.distance;
    this.state = 'complete';
    this.markerGroup.visible = false;
    if (this.passenger) {
      const actor = this.passenger;
      const safeExit = this.safeSidewalkSpotNear(this.drop);
      actor.leave(
        this.host.scene,
        safeExit.x,
        safeExit.z,
        safeExit.yaw,
        safeExit.x + 2.4,
        safeExit.z - 1.8,
      );
      this.leavingActors.push({ actor, ttl: 4.5 });
      this.passenger = null;
    }
    this.emit('dialogue', {
      key: mood > 65 ? 'd.thanks' : 'd.neutral',
      who: archetypeById(offer.archetype).whoKey,
      side: 'who',
    });
    this.emit('completed', { offer, fare, distance, time: t, mood });
    this.emit('hint', null);
    this.lastHint = null;
    this.offer = null;
  }

  mapData(): {
    pickup: PlaceDef | null;
    drop: PlaceDef | null;
    active: PlaceDef | null;
    kind: 'pickup' | 'drop' | null;
  } {
    const active = this.zone;
    return {
      pickup: this.pickup,
      drop: this.drop,
      active,
      kind: active ? this.markerLabel : null,
    };
  }

  dispose(): void {
    this.clearPassenger();
    this.flushLeavingActors();
    this.host.scene.remove(this.markerGroup);
    this.beacon.geometry.dispose();
    this.ring.geometry.dispose();
    this.pickupTexture.dispose();
    this.dropTexture.dispose();
  }
}
