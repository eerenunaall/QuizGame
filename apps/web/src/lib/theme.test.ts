import { describe, expect, it } from 'vitest';
import { createStorage, loadPreferences } from './storage';
import { applyTheme, pickTheme, resolveVenueLogo, saveTheme } from './theme';

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
});
