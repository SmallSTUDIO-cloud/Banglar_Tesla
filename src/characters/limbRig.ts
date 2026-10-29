/**
 * Shared humanoid limb-chain pose math (v0.5.2 / Master Upgrade vNext §2).
 *
 * One authoritative definition of "arm -> elbow -> forearm -> hand at grip"
 * endpoint geometry, used by every visible driver in the game:
 *   - NPC traffic drivers (instanced fleet archetypes, `src/ai/vehicles.ts`)
 *   - Player / race-AI / Blacklist-rival / showroom rigs (`src/vehicle/rickshawModel.ts`)
 *
 * Root cause this fixes (release-blocking duplicate-hands bug):
 *   Driver forearms previously terminated as rounded cylinder caps floating
 *   above/behind a separate hand box at the handlebar. The round arm cap read as
 *   a second fist next to the boxy hand ("extra/duplicated hands"). These helpers
 *   compute contiguous chains: the forearm terminates INSIDE the hand box at the
 *   grip, so each grip shows exactly one natural hand wrapped around the bar.
 *
 * Pure math (no rendering calls) so unit tests can assert:
 *   - exactly one chain per side,
 *   - wrist-to-hand continuity under a tight tolerance,
 *   - hand centred on the grip,
 *   - elbow bent outward (never through the torso).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CylinderSegment {
  /** Cylinder centre. */
  mid: Vec3;
  radius: number;
  length: number;
  /** Euler XYZ rotation aligning the unit +Y cylinder onto the segment direction. */
  rot: Vec3;
  /** Exact endpoints (for tests & elbow caps). */
  from: Vec3;
  to: Vec3;
}

export interface HandBox {
  center: Vec3;
  size: Vec3;
  rot: Vec3;
}

export interface ArmChainPose {
  side: 1 | -1;
  shoulder: Vec3;
  elbow: Vec3;
  /** Where the forearm geometry ends — kept INSIDE the hand box. */
  wrist: Vec3;
  grip: Vec3;
  upper: CylinderSegment;
  fore: CylinderSegment;
  hand: HandBox;
  /** Small elbow ball so upper/fore segments never show a seam. */
  elbowCap: { center: Vec3; radius: number };
}

export interface ArmChainOptions {
  side: 1 | -1;
  shoulder: Vec3;
  /** Handlebar grip centre in the character's chassis space. */
  grip: Vec3;
  upperRadius: number;
  foreRadius: number;
  handSize: Vec3;
  /** Outward elbow bend (metres, along the side axis) for a natural riding posture. */
  elbowBend?: number;
  /** Upward elbow lift (metres). */
  elbowLift?: number;
  /** Hand rotation (Euler XYZ) — e.g. a slight wrap tilt around the bar. */
  handRot?: Vec3;
  /**
   * How far the forearm overlaps into the hand box. Must exceed the hand's
   * half-extent along the forearm axis so no gap/joint blob can show.
   */
  wristOverlap?: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** Euler rotating the unit +Y axis onto `dir` in geo.ts's 'YXZ' bucket convention. */
function yToDirEuler(dir: Vec3): Vec3 {
  const d = normalize(dir);
  // geo.ts Bucket.add composes R = Ry(y)·Rx(x)·Rz(z) ('YXZ'). With z = 0:
  //   Rx(a)·Y = (0, cos a, sin a);  Ry(b)·that = (sin a·sin b, cos a, sin a·cos b)
  // => a = atan2(hypot(dx,dz), dy), b = atan2(dx, dz) exactly reproduces `d`.
  const a = Math.atan2(Math.hypot(d.x, d.z), d.y);
  const b = Math.atan2(d.x, d.z);
  return { x: a, y: b, z: 0 };
}

function cylinderBetween(from: Vec3, to: Vec3, radius: number): CylinderSegment {
  const dir = sub(to, from);
  const length = len(dir);
  const mid = add(from, scale(dir, 0.5));
  return {
    mid,
    radius,
    length,
    rot: yToDirEuler(dir),
    from: { ...from },
    to: { ...to },
  };
}

/**
 * Build one contiguous shoulder->elbow->forearm->hand chain for a driver whose
 * hand grips a handlebar at `grip`. The elbow is bent outward + slightly up so
 * arms never pass through the torso; the wrist ends inside the hand box.
 */
export function buildArmChain(opts: ArmChainOptions): ArmChainPose {
  const bend = opts.elbowBend ?? 0.075;
  const lift = opts.elbowLift ?? 0.045;
  const overlap = opts.wristOverlap ?? 0;

  const sh = opts.shoulder;
  const grip = opts.grip;

  // Elbow: midway shoulder->grip, pushed outward (side axis = X in chassis space)
  const mid = add(sh, scale(sub(grip, sh), 0.52));
  const elbow: Vec3 = {
    x: mid.x + opts.side * bend,
    y: mid.y + lift,
    z: mid.z,
  };

  // Wrist: approach the grip from the elbow but stop `overlap` short of the grip
  // centre, so the forearm's round cap is fully buried inside the hand box.
  const toGrip = normalize(sub(grip, elbow));
  const wrist = {
    x: grip.x - toGrip.x * overlap,
    y: grip.y - toGrip.y * overlap,
    z: grip.z - toGrip.z * overlap,
  };

  const upper = cylinderBetween(sh, elbow, opts.upperRadius);
  const fore = cylinderBetween(elbow, wrist, opts.foreRadius);

  const hand: HandBox = {
    center: { ...grip },
    size: opts.handSize,
    rot: opts.handRot ?? { x: 0, y: 0, z: 0 },
  };

  return {
    side: opts.side,
    shoulder: { ...sh },
    elbow,
    wrist,
    grip: { ...grip },
    upper,
    fore,
    hand,
    elbowCap: { center: { ...elbow }, radius: Math.max(opts.upperRadius, opts.foreRadius) * 1.08 },
  };
}

/** Two symmetric chains (left + right) for a driver gripping a bar at both grips. */
export function buildDriverArms(opts: {
  shoulderY: number;
  shoulderZ: number;
  shoulderX: number;
  shoulderCenterX?: number;
  gripLeft: Vec3;
  gripRight: Vec3;
  upperRadius: number;
  foreRadius: number;
  handSize: Vec3;
  elbowBend?: number;
  elbowLift?: number;
  handRotLeft?: Vec3;
  handRotRight?: Vec3;
}): [ArmChainPose, ArmChainPose] {
  const left = buildArmChain({
    side: 1,
    shoulder: { x: (opts.shoulderCenterX ?? 0) + opts.shoulderX, y: opts.shoulderY, z: opts.shoulderZ },
    grip: opts.gripLeft,
    upperRadius: opts.upperRadius,
    foreRadius: opts.foreRadius,
    handSize: opts.handSize,
    elbowBend: opts.elbowBend,
    elbowLift: opts.elbowLift,
    handRot: opts.handRotLeft,
  });
  const right = buildArmChain({
    side: -1,
    shoulder: { x: (opts.shoulderCenterX ?? 0) - opts.shoulderX, y: opts.shoulderY, z: opts.shoulderZ },
    grip: opts.gripRight,
    upperRadius: opts.upperRadius,
    foreRadius: opts.foreRadius,
    handSize: opts.handSize,
    elbowBend: opts.elbowBend,
    elbowLift: opts.elbowLift,
    handRot: opts.handRotRight,
  });
  return [left, right];
}

/** Gap between the forearm end and the hand box surface (0 => buried inside). */
export function wristToHandGap(chain: ArmChainPose): number {
  const h = chain.hand.size;
  const dx = Math.max(0, Math.abs(chain.wrist.x - chain.hand.center.x) - h.x * 0.5);
  const dy = Math.max(0, Math.abs(chain.wrist.y - chain.hand.center.y) - h.y * 0.5);
  const dz = Math.max(0, Math.abs(chain.wrist.z - chain.hand.center.z) - h.z * 0.5);
  return Math.hypot(dx, dy, dz);
}

/** Distance from the hand centre to the intended grip point (0 = perfectly seated). */
export function handGripOffset(chain: ArmChainPose): number {
  return len(sub(chain.hand.center, chain.grip));
}
