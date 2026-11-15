import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import { type ImageKind, type ParsedImage, checkDimensions, parseImageFor } from './images';

/** Most brand images one venue may keep: a logo, eight team marks and a few spares (ADR-0030 §4). */
export const MAX_ASSETS_PER_VENUE = 12;
/** Most question pictures one venue may keep (quiz night picture rounds): about 18 MB at the 300 KB cap. */
export const MAX_PICTURES_PER_VENUE = 60;

const storedKind = (kind: ImageKind): 'BRAND' | 'QUESTION' =>
  kind === 'PICTURE' ? 'QUESTION' : 'BRAND';

export interface AssetMeta extends ParsedImage {
  hash: string;
  bytes: number;
  createdAt: number;
}

export class AssetLimitError extends Error {}

/** An unreferenced image younger than this survives a settings save, so "Geri al" can bring it back. */
export const ASSET_GC_GRACE_MS = 5 * 60_000;
/** A picture waits a day for the night that will use it to be saved. */
export const PICTURE_GC_GRACE_MS = 24 * 60 * 60_000;

/**
 * A venue's images in PostgreSQL. Everything here is keyed by the venue: a hash that exists for another
 * venue is simply not found, so one venue can never read, list or reference another venue's image.
 */
export class VenueAssetStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => number,
  ) {}

  /** The venue's brand images (logo, team marks). Question pictures are not listed here. */
  async list(venueId: string): Promise<AssetMeta[]> {
    const rows = await this.db
      .selectFrom('venue_assets')
      .select([
        'sha256',
        'content_type',
        'width',
        'height',
        'created_at',
        sql<number>`octet_length(bytes)`.as('size'),
      ])
      .where('venue_id', '=', venueId)
      .where('kind', '=', 'BRAND')
      .orderBy('created_at')
      .execute();
    return rows.map((row) => ({
      hash: row.sha256,
      contentType: row.content_type as ParsedImage['contentType'],
      width: row.width,
      height: row.height,
      bytes: Number(row.size),
      createdAt: new Date(row.created_at).getTime(),
    }));
  }

  /** hash -> size of every image the venue keeps (for validating settings and building the room view). */
  async dimensions(venueId: string): Promise<Map<string, { width: number; height: number }>> {
    const rows = await this.db
      .selectFrom('venue_assets')
      .select(['sha256', 'width', 'height'])
      .where('venue_id', '=', venueId)
      .execute();
    return new Map(rows.map((row) => [row.sha256, { width: row.width, height: row.height }]));
  }

  /**
   * Parses the file completely, then stores it. The same bytes twice give the same answer (idempotent
   * by hash) and cost no slot. Throws `ImageRejected` for a refused file and `AssetLimitError` when the
   * venue already keeps the most it may.
   */
  async put(
    venueId: string,
    accountId: string,
    imageKind: ImageKind,
    bytes: Uint8Array,
  ): Promise<AssetMeta> {
    const image = parseImageFor(bytes, imageKind);
    const hash = createHash('sha256').update(bytes).digest('hex');
    return this.db.transaction().execute(async (trx) => {
      // One writer per venue at a time, so the count below cannot be raced past the limit.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`venue-assets:${venueId}`}, 0))`.execute(
        trx,
      );
      const existing = await trx
        .selectFrom('venue_assets')
        .select(['created_at'])
        .where('venue_id', '=', venueId)
        .where('sha256', '=', hash)
        .executeTakeFirst();
      if (existing)
        return {
          ...image,
          hash,
          bytes: bytes.length,
          createdAt: new Date(existing.created_at).getTime(),
        };
      const kind = storedKind(imageKind);
      const count = await trx
        .selectFrom('venue_assets')
        .select(sql<number>`count(*)`.as('n'))
        .where('venue_id', '=', venueId)
        .where('kind', '=', kind)
        .executeTakeFirstOrThrow();
      const most = kind === 'QUESTION' ? MAX_PICTURES_PER_VENUE : MAX_ASSETS_PER_VENUE;
      if (Number(count.n) >= most) throw new AssetLimitError('venue is full');
      const createdAt = this.now();
      await trx
        .insertInto('venue_assets')
        .values({
          venue_id: venueId,
          sha256: hash,
          content_type: image.contentType,
          kind,
          width: image.width,
          height: image.height,
          bytes: Buffer.from(bytes),
          created_by: accountId,
          created_at: new Date(createdAt),
        })
        .execute();
      return { ...image, hash, bytes: bytes.length, createdAt };
    });
  }

  /** The bytes for a (venue, hash) pair, or null: a wrong venue and a wrong hash are the same answer. */
  async read(
    venueId: string,
    hash: string,
  ): Promise<{ bytes: Buffer; contentType: ParsedImage['contentType'] } | null> {
    const row = await this.db
      .selectFrom('venue_assets')
      .select(['bytes', 'content_type'])
      .where('venue_id', '=', venueId)
      .where('sha256', '=', hash)
      .executeTakeFirst();
    return row
      ? { bytes: row.bytes, contentType: row.content_type as ParsedImage['contentType'] }
      : null;
  }

  async remove(venueId: string, hash: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('venue_assets')
      .where('venue_id', '=', venueId)
      .where('sha256', '=', hash)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  /**
   * Drops brand images nothing refers to any more (older than the grace), so the 12 slots do not fill up.
   * Question pictures are never touched here: the look does not refer to them (see `collectPictures`).
   */
  async collect(venueId: string, referenced: ReadonlySet<string>): Promise<number> {
    return this.collectKind(venueId, 'BRAND', referenced, ASSET_GC_GRACE_MS);
  }

  /** Drops question pictures no quiz night of the venue uses (a day's grace for a night being prepared). */
  async collectPictures(venueId: string): Promise<number> {
    const nights = await this.db
      .selectFrom('quiz_nights')
      .select('config')
      .where('venue_id', '=', venueId)
      .execute();
    const used = new Set<string>();
    for (const night of nights)
      for (const match of JSON.stringify(night.config).matchAll(
        /\/v1\/venue-assets\/[0-9a-f-]{36}\/([0-9a-f]{64})/gu,
      ))
        used.add(match[1]!);
    return this.collectKind(venueId, 'QUESTION', used, PICTURE_GC_GRACE_MS);
  }

  private async collectKind(
    venueId: string,
    kind: 'BRAND' | 'QUESTION',
    referenced: ReadonlySet<string>,
    graceMs: number,
  ): Promise<number> {
    const cutoff = new Date(this.now() - graceMs);
    const rows = await this.db
      .selectFrom('venue_assets')
      .select('sha256')
      .where('venue_id', '=', venueId)
      .where('kind', '=', kind)
      .where('created_at', '<', cutoff)
      .execute();
    const stale = rows.map((row) => row.sha256).filter((hash) => !referenced.has(hash));
    if (stale.length === 0) return 0;
    await this.db
      .deleteFrom('venue_assets')
      .where('venue_id', '=', venueId)
      .where('sha256', 'in', stale)
      .execute();
    return stale.length;
  }
}

/** Do the settings' hashes point at images of this venue that fit their slot? */
export function lookAssetsValid(
  look: { logo: string | null; teamLogos: readonly (string | null)[] },
  known: ReadonlyMap<string, { width: number; height: number }>,
): boolean {
  if (look.logo !== null) {
    const size = known.get(look.logo);
    if (!size || !checkDimensions('LOGO', size.width, size.height)) return false;
  }
  for (const hash of look.teamLogos) {
    if (hash === null) continue;
    const size = known.get(hash);
    if (!size || !checkDimensions('TEAM', size.width, size.height)) return false;
  }
  return true;
}
