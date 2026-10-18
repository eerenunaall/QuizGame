import { describe, expect, it } from 'vitest';
import { createStorage, loadPreferences } from './storage';
import { applyTheme, pickTheme, resolveVenueInfo, resolveVenueLogo, saveTheme } from './theme';

const memory = () => createStorage(null);

describe('theme selection', () => {
  it('defaults to party', () => {
    expect(pickTheme('', memory())).toBe('party');
  });
  it('?theme= beats saved beats env default; junk is ignored', () => {
    const storage = memory();
    saveTheme(storage, 'high-contrast');
    expect(pickTheme('?theme=venue-gold', storage, { VITE_DEFAULT_THEME: 'party' })).toBe(
      'venue-gold',
    );
    expect(pickTheme('', storage, { VITE_DEFAULT_THEME: 'venue-gold' })).toBe('high-contrast');
    expect(pickTheme('?theme=neon', memory(), { VITE_DEFAULT_THEME: 'venue-gold' })).toBe(
      'venue-gold',
    );
    expect(pickTheme('', memory(), { VITE_DEFAULT_THEME: 'bogus' })).toBe('party');
  });
  it('saving a theme keeps the other preferences and rejects invalid stored themes', () => {
    const storage = memory();
    saveTheme(storage, 'venue-gold');
    expect(loadPreferences(storage).theme).toBe('venue-gold');
    void storage.set('qp.prefs', JSON.stringify({ theme: 'x' }));
    expect(loadPreferences(storage).theme).toBeUndefined();
  });
  it('applyTheme sets data-theme', () => {
    applyTheme(document, 'venue-gold');
    expect(document.documentElement.dataset.theme).toBe('venue-gold');
    applyTheme(document, 'party');
  });
  it('accepts only same-origin or https image paths for the logo', () => {
    expect(resolveVenueLogo('/venue/logo.svg')).toBe('/venue/logo.svg');
    expect(resolveVenueLogo('https://cdn.example/logo.png')).toBe('https://cdn.example/logo.png');
    for (const bad of [
      '',
      undefined,
      '//evil.example/a.svg',
      'javascript:alert(1).svg',
      'http://x/a.svg',
      '/a.svg" onerror="x',
      '/a.exe',
    ])
      expect(resolveVenueLogo(bad)).toBeNull();
  });
  it('gusto is selectable by ?theme= and as the deployment default', () => {
    expect(pickTheme('?theme=gusto', memory())).toBe('gusto');
    expect(pickTheme('', memory(), { VITE_DEFAULT_THEME: 'gusto' })).toBe('gusto');
    applyTheme(document, 'gusto');
    expect(document.documentElement.dataset.theme).toBe('gusto');
    applyTheme(document, 'party');
  });
  it('shows a venue credit only from env, or the Gusto default inside the gusto theme', () => {
    expect(resolveVenueInfo('party', {})).toBeNull();
    expect(resolveVenueInfo('venue-gold', { VITE_VENUE_NAME: '  ' })).toBeNull();
    expect(resolveVenueInfo('gusto', {})).toEqual({
      name: 'Gusto Board Game',
      credit: 'by Eren Ünal',
    });
    expect(resolveVenueInfo('party', { VITE_VENUE_NAME: 'Cafe X' })).toEqual({
      name: 'Cafe X',
      credit: '',
    });
    // an env value, even for the gusto theme, wins over the default
    expect(resolveVenueInfo('gusto', { VITE_VENUE_CREDIT: 'by Y' })).toEqual({
      name: '',
      credit: 'by Y',
    });
    expect(resolveVenueInfo('party', { VITE_VENUE_NAME: 'x'.repeat(500) })!.name).toHaveLength(60);
  });
});
