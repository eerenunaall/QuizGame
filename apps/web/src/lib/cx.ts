/** Joins class names, skipping anything falsy (CSS-module lookups can be undefined). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .join(' ');
}
