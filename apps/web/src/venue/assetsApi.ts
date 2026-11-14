import { call } from './api';

export interface VenueAssetView {
  hash: string;
  contentType: 'image/png' | 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
}

/** The same-origin address of a venue image: the hash is the proof (ADR-0030 §4). */
export const assetUrl = (venueId: string, hash: string): string =>
  `/v1/venue-assets/${encodeURIComponent(venueId)}/${hash}`;

/** The most a logo file may weigh; the server checks again and so does every parser step. */
export const MAX_ASSET_BYTES = 300 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/webp', 'image/jpeg'] as const;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk)
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

const base = (venueId: string): string => `/v1/venues/${encodeURIComponent(venueId)}/assets`;

export const assetsApi = {
  list: (venueId: string) => call<{ assets: VenueAssetView[] }>(base(venueId), 'GET'),
  /** Same bytes, same answer: re-uploading an image the venue already has returns it. */
  upload: (venueId: string, kind: 'LOGO' | 'TEAM', bytes: Uint8Array) =>
    call<{ asset: VenueAssetView }>(base(venueId), 'POST', { kind, data: toBase64(bytes) }),
  remove: (venueId: string, hash: string) =>
    call<{ ok: true }>(`${base(venueId)}/${hash}/remove`, 'POST', {}),
};
