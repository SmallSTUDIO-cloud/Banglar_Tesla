/**
 * Mission runtime: offers, pickup/drop-off zones, passenger boarding, mood and
 * the final fare breakdown. Renders the world-space markers and beacons.
 */

import * as THREE from 'three';
import { Emitter } from '../core/events';
import { MISSION } from '../core/config';
import { clamp, clamp01 } from '../core/mathx';
import { computeFare, type FareBreakdown } from '../economy/economy';
import { placeById, type PlaceDef } from '../world/layout';
import { archetypeById, PassengerActor } from './actors';
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

function markerTexture(color: string, glyph: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
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
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class MissionSystem extends Emitter<MissionEvents> {
  state: MissionState = 'none';
  offer: MissionOffer | null = null;
  passenger: PassengerActor | null = null;
  mood = MISSION.moodStart;
  elapsed = 0;
  boardedAt = 0;
  distance = 0;
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
    return this.markerGroup.position.clone().add(new THREE.Vector3(0, 2.2, 0));
  }

  start(offer: MissionOffer): void {
    this.clearPassenger();
    this.offer = offer;
    this.pickup = placeById(offer.pickupId) ?? null;
    this.drop = placeById(offer.dropId) ?? null;
    this.state = 'toPickup';
    this.mood = clamp(MISSION.moodStart + archetypeById(offer.archetype).moodBias, 40, 100);
    this.elapsed = 0;
    this.distance = 0;
    this.boardingTimer = 0;

    if (this.pickup) {
      const variant = (offer.seed % 3) - 1;
      const side = this.pickup.x > 0 ? 2.9 : -2.9;
      const actor = new PassengerActor(archetypeById(offer.archetype));
      actor.place(this.pickup.x + side + variant * 0.4, this.pickup.z + 1.4 + variant * 0.6, 0);
      this.host.scene.add(actor.group);
      this.passenger = actor;
      this.setMarker(this.pickup, 'pickup');
      this.emit('hint', 'hud.hintPickup');
      this.lastHint = 'hud.hintPickup';
      this.emit('dialogue', { key: archetypeById(offer.archetype).greetKey, who: archetypeById(offer.archetype).whoKey, side: 'who' });
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
    this.emit('hint', null);
    this.lastHint = null;
  }

  /** Player hit something: reduce the rider's mood. */
  registerImpact(strength: number): void {
    if (this.state !== 'toDropoff' && this.state !== 'toPickup') return;
    if (strength < 0.5) return;
    const penalty = MISSION.moodCollisionHit * clamp(strength / 2.2, 0.4, 1.6);
    this.mood = clamp(this.mood - penalty, 0, 100);
    this.emit('mood', this.mood);
    if (Math.random() < 0.45) {
      this.emit('dialogue', { key: 'd.annoyed', who: archetypeById(this.offer?.archetype ?? 'student').whoKey, side: 'who' });
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
    if (this.state === 'none') return;
    this.elapsed += dt;

    // markers pulse; the beacon fades out when the camera would be inside it
    const t = performance.now() * 0.001;
    const pulse = 0.5 + Math.sin(t * 3.1) * 0.5;
    const playerDist = Math.hypot(this.host.playerX() - this.markerGroup.position.x, this.host.playerZ() - this.markerGroup.position.z);
    const inside = clamp01((playerDist - 2.0) / 6.0);
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = (0.1 + pulse * 0.1) * inside;
    this.beacon.visible = inside > 0.02;
    this.beacon.scale.setScalar(1 + pulse * 0.05);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + pulse * 0.35;
    this.ring.scale.setScalar(1 + pulse * 0.08);
    this.sprite.position.y = 4.2 + Math.sin(t * 2.2) * 0.16;

    const px = this.host.playerX();
    const pz = this.host.playerZ();
    this.passenger?.update(dt);

    if (this.state === 'toPickup' && this.pickup) {
      const dist = Math.hypot(px - this.pickup.x, pz - this.pickup.z);
      this.hint(dist < MISSION.acceptRadius ? (speed < MISSION.pickupStopSpeed ? 'hud.hintPickup' : 'hud.hintPickup') : 'hud.hintPickup');
      if (dist < MISSION.acceptRadius && Math.abs(speed) < MISSION.pickupStopSpeed) {
        this.state = 'boarding';
        this.boardingTimer = 0;
        const targetX = this.host.playerX() + Math.cos(0) * 0.9;
        const targetZ = this.host.playerZ();
        this.passenger?.walkTo(targetX, targetZ, () => {
          if (!this.passenger) return;
          this.passenger.seat(this.host.seatAnchor);
          this.state = 'toDropoff';
          this.boardedAt = this.elapsed;
          if (this.drop) this.setMarker(this.drop, 'drop');
          this.emit('boarded', this.offer!);
          this.emit('dialogue', { key: 'd.enter', who: archetypeById(this.offer!.archetype).whoKey, side: 'who' });
          this.emit('hint', 'hud.hintDrop');
        });
      }
    } else if (this.state === 'boarding') {
      this.boardingTimer += dt;
      // safety: if the passenger cannot reach the rickshaw, board anyway
      if (this.boardingTimer > 4.5) {
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
      // occasional mid-route rider chatter
      this.poseTimer += dt;
      if (this.poseTimer > 26 && Math.random() < 0.5) {
        this.poseTimer = 0;
        const key = this.mood > 78 ? 'd.midroute' : this.mood > 45 ? 'd.lane' : 'd.annoyed';
        this.emit('dialogue', { key, who: archetypeById(this.offer!.archetype).whoKey, side: 'who' });
      }
      // smooth driving slowly recovers mood
      if (Math.abs(speed) > 0.6) {
        this.mood = clamp(this.mood + MISSION.moodSmoothGainPerSecond * dt, 0, 100);
        this.emit('mood', this.mood);
      }
    }
  }

  private completeRide(): void {
    if (!this.offer || !this.drop) return;
    const t = this.elapsed - this.boardedAt;
    const fare = computeFare({
      distance: this.offer.distance,
      timeTaken: t,
      targetTime: this.offer.targetTime,
      mood: this.mood,
      damage: 0,
      fareMultiplier: this.offer.multiplier,
    });
    const offer = this.offer;
    const mood = this.mood;
    const distance = this.offer.distance;
    this.state = 'complete';
    this.markerGroup.visible = false;
    if (this.passenger) {
      const actor = this.passenger;
      const px = this.host.playerX();
      const pz = this.host.playerZ();
      actor.leave(this.host.scene, px + 1.1, pz - 0.6, 0.6, px + 4.2, pz - 2.4);
      // remove the actor after it walks away
      setTimeout(() => actor.dispose(), 9000);
      this.passenger = null;
    }
    this.emit('dialogue', { key: mood > 65 ? 'd.thanks' : 'd.neutral', who: archetypeById(offer.archetype).whoKey, side: 'who' });
    this.emit('completed', { offer, fare, distance, time: t, mood });
    this.emit('hint', null);
    this.lastHint = null;
    this.offer = null;
  }

  /** Mini-map payload: active zone + player heading. */
  mapData(): { pickup: PlaceDef | null; drop: PlaceDef | null; active: PlaceDef | null; kind: 'pickup' | 'drop' | null } {
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
    this.host.scene.remove(this.markerGroup);
    this.beacon.geometry.dispose();
    this.ring.geometry.dispose();
  }
}
