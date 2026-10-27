/**
 * Permanent career scrapbook & history (Master Upgrade vNext §10).
 *
 * - Deduplicated records with stable ids: retried races never duplicate money
 *   or records; losses dedupe inside a cooldown window; purchases/upgrades
 *   record once per (item, level).
 * - Bounded storage: metadata + at most `MAX_PHOTO_THUMBNAILS` small framed
 *   victory thumbnails (JPEG data URLs ≤ ~14 KB each); everything else stores
 *   metadata only and reopens as a designed framed record card (never a broken
 *   screenshot button).
 * - Pure data module (no DOM/rendering) so unit tests can exercise dedup,
 *   serialization and migration directly.
 */

export type ScrapbookCategory =
  | 'race'
  | 'blacklist'
  | 'rival'
  | 'photo'
  | 'police'
  | 'record'
  | 'stunt'
  | 'event'
  | 'weather'
  | 'purchase'
  | 'unlock'
  | 'customization'
  | 'milestone';

export interface ScrapbookRecord {
  id: string;
  category: ScrapbookCategory;
  titleBn: string;
  titleEn: string;
  detailBn: string;
  detailEn: string;
  /** In-game clock minutes when the record happened. */
  minutesOfDay: number;
  vehicleId: string;
  takaDelta?: number;
  repDelta?: number;
  placement?: 1 | 2 | 3 | 4;
  topSpeedKmh?: number;
  timeSeconds?: number;
  /** Bounded JPEG data-URL thumbnail for framed victory photos (≤ cap). */
  photoThumb?: string;
  createdAtRealMs: number;
}

export interface ScrapbookSnapshot {
  records: ScrapbookRecord[];
  /** Lifetime bests kept O(1) for HUD + milestone checks. */
  topSpeedKmh: number;
  totalTakaEarned: number;
  totalRepEarned: number;
  raceWins: number;
  raceLosses: number;
  policeEscapes: number;
  maxHeatSurvived: number;
  nearMisses: number;
  stunts: number;
  bestCombo: number;
  stormRides: number;
  rainRides: number;
  rareEvents: number;
  photoCount: number;
}

export const MAX_SCRAPBOOK_RECORDS = 240;
export const MAX_PHOTO_THUMBNAILS = 8;
/** Bounded thumbnail payload cap (data URL length) ~14 KB. */
export const MAX_PHOTO_BYTES = 18_500;

function emptySnapshot(): ScrapbookSnapshot {
  return {
    records: [],
    topSpeedKmh: 0,
    totalTakaEarned: 0,
    totalRepEarned: 0,
    raceWins: 0,
    raceLosses: 0,
    policeEscapes: 0,
    maxHeatSurvived: 0,
    nearMisses: 0,
    stunts: 0,
    bestCombo: 0,
    stormRides: 0,
    rainRides: 0,
    rareEvents: 0,
    photoCount: 0,
  };
}

export interface ScrapbookAddResult {
  added: boolean;
  reason: 'added' | 'duplicate-id' | 'over-record-cap' | 'bad-input';
}

export class Scrapbook {
  private snap: ScrapbookSnapshot = emptySnapshot();
  private byId = new Map<string, number>(); // id -> records index
  private lossWindow = new Map<string, number>(); // eventId -> last loss bucket

  get snapshot(): Readonly<ScrapbookSnapshot> {
    return this.snap;
  }

  get recordCount(): number {
    return this.snap.records.length;
  }

  get photoCount(): number {
    return this.snap.photoCount;
  }

  /**
   * Add one record. Ids are stable and deduplicated: retrying the same race can
   * only ever create ONE `win:<eventId>` record (rewards also granted once by
   * the economy layer), and loss spam collapses inside 60 s windows.
   */
  addRecord(rec: Omit<ScrapbookRecord, 'createdAtRealMs'>, nowRealMs = Date.now()): ScrapbookAddResult {
    if (!rec || typeof rec.id !== 'string' || rec.id.length === 0) {
      return { added: false, reason: 'bad-input' };
    }
    if (this.byId.has(rec.id)) {
      return { added: false, reason: 'duplicate-id' };
    }
    if (this.snap.records.length >= MAX_SCRAPBOOK_RECORDS) {
      // Bound growth: drop the OLDEST low-value record to keep the newest history.
      this.evictOldestNonEssential();
      if (this.snap.records.length >= MAX_SCRAPBOOK_RECORDS) {
        return { added: false, reason: 'over-record-cap' };
      }
    }
    let photoThumb: string | undefined;
    if (rec.photoThumb) {
      if (rec.photoThumb.length <= MAX_PHOTO_BYTES && this.snap.photoCount < MAX_PHOTO_THUMBNAILS) {
        photoThumb = rec.photoThumb;
        this.snap.photoCount++;
      }
      // else: keep the record but reopen it as a designed framed card (never broken)
    }
    const record: ScrapbookRecord = {
      ...rec,
      photoThumb,
      createdAtRealMs: nowRealMs,
    };
    this.snap.records.push(record);
    this.byId.set(record.id, this.snap.records.length - 1);

    // O(1) lifetime aggregates
    if (record.takaDelta && record.takaDelta > 0) this.snap.totalTakaEarned += record.takaDelta;
    if (record.repDelta && record.repDelta > 0) this.snap.totalRepEarned += record.repDelta;
    if (record.topSpeedKmh && record.topSpeedKmh > this.snap.topSpeedKmh) {
      this.snap.topSpeedKmh = record.topSpeedKmh;
    }
    if (record.category === 'race') {
      if (record.id.startsWith('win:')) this.snap.raceWins++;
      else if (record.id.startsWith('loss:')) this.snap.raceLosses++;
    }
    return { added: true, reason: 'added' };
  }

  /**
   * Loss records dedupe inside 60-second real-time windows per event so an
   * exploit loop can never flood the scrapbook (and can never farm records).
   */
  recordRaceLoss(
    eventId: string,
    detail: { minutesOfDay: number; vehicleId: string; topSpeedKmh?: number; timeSeconds?: number; placement?: 1 | 2 | 3 | 4 },
    nowRealMs = Date.now(),
  ): ScrapbookAddResult {
    const bucket = Math.floor(nowRealMs / 60_000);
    const last = this.lossWindow.get(eventId) ?? -1;
    if (last === bucket) {
      return { added: false, reason: 'duplicate-id' };
    }
    this.lossWindow.set(eventId, bucket);
    return this.addRecord(
      {
        id: `loss:${eventId}:${bucket}`,
        category: 'race',
        titleBn: 'রেস পরাজয়',
        titleEn: 'Race Defeat',
        detailBn: `প্রতিযোগিতা শেষ: ${eventId}`,
        detailEn: `Event complete: ${eventId}`,
        minutesOfDay: detail.minutesOfDay,
        vehicleId: detail.vehicleId,
        topSpeedKmh: detail.topSpeedKmh,
        timeSeconds: detail.timeSeconds,
        placement: detail.placement,
      },
      nowRealMs,
    );
  }

  /** Purchases/upgrades record once per (item, level) — retries never duplicate. */
  recordPurchase(
    itemId: string,
    level: number,
    detail: { minutesOfDay: number; vehicleId: string; takaDelta: number },
    nowRealMs = Date.now(),
  ): ScrapbookAddResult {
    return this.addRecord(
      {
        id: `purchase:${itemId}:${level}`,
        category: 'purchase',
        titleBn: 'ক্রয় / আপগ্রেড',
        titleEn: 'Purchase / Upgrade',
        detailBn: `${itemId} (স্তর ${level})`,
        detailEn: `${itemId} (level ${level})`,
        minutesOfDay: detail.minutesOfDay,
        vehicleId: detail.vehicleId,
        takaDelta: -Math.abs(detail.takaDelta),
      },
      nowRealMs,
    );
  }

  /** Best-of records: near misses / stunts / combos / weather moments. */
  recordStat(stat: keyof ScrapbookSnapshot, value = 1): void {
    switch (stat) {
      case 'nearMisses':
        this.snap.nearMisses += value;
        break;
      case 'stunts':
        this.snap.stunts += value;
        break;
      case 'policeEscapes':
        this.snap.policeEscapes += value;
        break;
      case 'stormRides':
        this.snap.stormRides += value;
        break;
      case 'rainRides':
        this.snap.rainRides += value;
        break;
      case 'rareEvents':
        this.snap.rareEvents += value;
        break;
      default:
        break;
    }
  }

  recordBestCombo(combo: number): void {
    if (combo > this.snap.bestCombo) this.snap.bestCombo = combo;
  }

  recordHeat(heat: number): void {
    if (heat > this.snap.maxHeatSurvived) this.snap.maxHeatSurvived = heat;
  }

  findRecord(id: string): ScrapbookRecord | undefined {
    const idx = this.byId.get(id);
    return idx === undefined ? undefined : this.snap.records[idx];
  }

  /** First-win record is write-once per event id. */
  hasWin(eventId: string): boolean {
    return this.byId.has(`win:${eventId}`);
  }

  private evictOldestNonEssential(): void {
    for (let i = 0; i < this.snap.records.length; i++) {
      const r = this.snap.records[i];
      if (r.category === 'purchase' || r.category === 'race') continue; // keep economy/race history
      this.snap.records.splice(i, 1);
      this.rebuildIndex();
      return;
    }
    // all essential: drop oldest record overall
    this.snap.records.shift();
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.byId.clear();
    for (let i = 0; i < this.snap.records.length; i++) {
      this.byId.set(this.snap.records[i].id, i);
    }
  }

  /** Serialize for the save system (bounded). */
  toJSON(): ScrapbookSnapshot {
    return this.snap;
  }

  /** Restore from save data with dedup + safe defaults (vNext §10 migration). */
  static fromJSON(raw: unknown): Scrapbook {
    const book = new Scrapbook();
    if (!raw || typeof raw !== 'object') return book;
    const data = raw as Partial<ScrapbookSnapshot>;
    const records = Array.isArray(data.records) ? data.records.slice(0, MAX_SCRAPBOOK_RECORDS) : [];
    for (const rec of records) {
      if (rec && typeof rec.id === 'string') {
        book.addRecord(rec, rec.createdAtRealMs ?? Date.now());
      }
    }
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    book.snap.topSpeedKmh = Math.max(num(data.topSpeedKmh), book.snap.topSpeedKmh);
    book.snap.totalTakaEarned = Math.max(num(data.totalTakaEarned), book.snap.totalTakaEarned);
    book.snap.totalRepEarned = Math.max(num(data.totalRepEarned), book.snap.totalRepEarned);
    book.snap.raceWins = Math.max(num(data.raceWins), book.snap.raceWins);
    book.snap.raceLosses = Math.max(num(data.raceLosses), book.snap.raceLosses);
    book.snap.policeEscapes = Math.max(num(data.policeEscapes), book.snap.policeEscapes);
    book.snap.maxHeatSurvived = Math.max(num(data.maxHeatSurvived), book.snap.maxHeatSurvived);
    book.snap.nearMisses = Math.max(num(data.nearMisses), book.snap.nearMisses);
    book.snap.stunts = Math.max(num(data.stunts), book.snap.stunts);
    book.snap.bestCombo = Math.max(num(data.bestCombo), book.snap.bestCombo);
    book.snap.stormRides = Math.max(num(data.stormRides), book.snap.stormRides);
    book.snap.rainRides = Math.max(num(data.rainRides), book.snap.rainRides);
    book.snap.rareEvents = Math.max(num(data.rareEvents), book.snap.rareEvents);
    book.snap.photoCount = book.snap.records.filter((r) => r.photoThumb).length;
    return book;
  }
}
