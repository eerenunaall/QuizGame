import type { VenueDisplay } from '@quizparty/game-engine';
import type { VenueSettings } from './settings';

/** The same-origin path a venue image is served from (ADR-0030 §4). */
export const assetPath = (venueId: string, hash: string): string =>
  `/v1/venue-assets/${venueId}/${hash}`;

/**
 * What a café table's screens may learn about the venue (ADR-0030 §3): built field by field from the
 * settings, so a new setting reaches a screen only when someone adds it here and to the strict schema.
 * `hasAsset` drops a hash whose image was removed since the settings were saved (a dead link on the TV
 * is worse than the default icon).
 */
export function buildVenueDisplay(
  venue: { id: string; name: string },
  settings: VenueSettings,
  hasAsset: (hash: string) => boolean = () => true,
): VenueDisplay {
  const { entrance, look } = settings;
  const logo = look.logo !== null && hasAsset(look.logo) ? assetPath(venue.id, look.logo) : null;
  const teams = look.teamLogos.map((hash) =>
    hash !== null && hasAsset(hash) ? assetPath(venue.id, hash) : null,
  );
  while (teams.length > 0 && teams[teams.length - 1] === null) teams.pop();
  return {
    ...(entrance.enabled && entrance.text !== ''
      ? {
          entrance: {
            text: entrance.text,
            ...(entrance.note !== '' ? { note: entrance.note } : {}),
          },
        }
      : {}),
    look: {
      name: venue.name.slice(0, 60),
      theme: look.theme,
      ...(look.accent !== null ? { accent: look.accent } : {}),
    },
    ...(logo !== null || teams.length > 0
      ? {
          branding: {
            ...(logo !== null ? { logo } : {}),
            ...(teams.length > 0 ? { teams } : {}),
          },
        }
      : {}),
  };
}
