import { useSyncExternalStore } from 'react';
import { isThemeId, type ThemeId } from '@quizparty/ui-tokens';

const read = (): ThemeId => {
  const value =
    typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme;
  return isThemeId(value) ? value : 'party';
};

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** The theme currently applied to the page (`data-theme`), following runtime changes from Settings. */
export const useDataTheme = (): ThemeId => useSyncExternalStore(subscribe, read, () => 'party');
