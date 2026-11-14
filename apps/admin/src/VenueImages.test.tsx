import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VenueImages } from './pages/VenueImages';
import { fakeServer } from './testing';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VENUE = '6f1c1a2e-3333-4b7a-9c1d-000000000003';
const HASH = 'ab'.repeat(32);

describe('a venue’s images in the console (ADR-0030 §4)', () => {
  it('lists the images with their size and removes one after a confirmation', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    let removed = false;
    const { calls } = fakeServer((call) => {
      if (call.path === `/v1/admin/venues/${VENUE}/assets` && call.method === 'GET')
        return {
          json: {
            assets: removed
              ? []
              : [
                  {
                    hash: HASH,
                    contentType: 'image/png',
                    width: 400,
                    height: 150,
                    bytes: 2048,
                    createdAt: '2026-11-06T10:00:00Z',
                  },
                ],
          },
        };
      if (call.path === `/v1/admin/venues/${VENUE}/assets/${HASH}/remove`) {
        removed = true;
        return { json: { ok: true } };
      }
      return undefined;
    });
    render(<VenueImages venueId={VENUE} />);
    const button = await screen.findByTestId(`venue-image-remove-${HASH.slice(0, 8)}`);
    expect(screen.getByTestId('venue-images').textContent).toContain('400×150');
    expect(screen.getByTestId('venue-images').querySelector('img')?.getAttribute('src')).toBe(
      `/v1/venue-assets/${VENUE}/${HASH}`,
    );
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('venue-images').textContent).toContain('henüz'));
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/remove'))).toBe(
      true,
    );
  });
});
