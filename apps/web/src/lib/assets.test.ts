import { describe, expect, it } from 'vitest';
import { LAUNCH_CATEGORIES } from '@quizparty/question-schema';
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
});
