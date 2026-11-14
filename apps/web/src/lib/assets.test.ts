import { describe, expect, it } from 'vitest';
import { LAUNCH_CATEGORIES } from '@quizparty/question-schema';
import demoCategories from '../../../../seed/demo/categories.json';
import gustoCategories from '../../../../seed/gusto/categories.json';
import { categoryIcon, stickerUrl } from './assets';

describe('category icons', () => {
  it('give every launch category a picture of its own, not the fallback globe', () => {
    const icons = LAUNCH_CATEGORIES.map((category) => categoryIcon(category.id));
    const fallback = categoryIcon('no-such-category');
    for (const [index, category] of LAUNCH_CATEGORIES.entries()) {
      if (category.id === 'general') continue; // the globe is the right picture for general knowledge
      expect({ id: category.id, icon: icons[index] }).not.toEqual({
        id: category.id,
        icon: fallback,
      });
    }
    expect(new Set(icons).size).toBe(LAUNCH_CATEGORIES.length);
  });

  it('point at files that exist', () => {
    for (const category of LAUNCH_CATEGORIES)
      expect(stickerUrl(categoryIcon(category.id))).not.toBe('');
  });

  it('never leave a hole for a category added later', () => {
    expect(stickerUrl(categoryIcon('added-next-year'))).not.toBe('');
  });

  it('give every seeded demo category its own icon, distinct from the fallback and each other', () => {
    const demo: { id: string }[] = demoCategories;
    const fallback = categoryIcon('no-such-category');
    const icons = demo.map((category) => categoryIcon(category.id));
    expect(icons).not.toContain(fallback);
    expect(new Set(icons).size).toBe(demo.length);
    for (const icon of icons) expect(stickerUrl(icon)).not.toBe('');
  });

  it('give every category of the Gusto bank an icon of its own (only general may be the globe)', () => {
    const all: { id: string }[] = gustoCategories;
    const fallback = categoryIcon('no-such-category');
    const icons = all.map((category) => categoryIcon(category.id));
    for (const [index, category] of all.entries())
      if (category.id !== 'general')
        expect({ id: category.id, icon: icons[index] }).not.toEqual({
          id: category.id,
          icon: fallback,
        });
    expect(new Set(icons).size).toBe(all.length);
    for (const icon of icons) expect(stickerUrl(icon)).not.toBe('');
    expect(all.length).toBeGreaterThanOrEqual(35);
  });
});
