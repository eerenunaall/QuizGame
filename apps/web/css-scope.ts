import { createHash } from 'node:crypto';

/**
 * Class and keyframe names of a CSS module get a per-file suffix so two files can both have `.card`.
 * The suffix must NOT be added to the shared motion vocabulary: `animation: qp-pop-in ...` in a module
 * refers to `@keyframes qp-pop-in` in `styles/global.css` / `styles/motion.css`. With the default
 * naming the reference was renamed to `_qp-pop-in_<hash>`, which matches no keyframes, so the
 * animation silently never ran (every shared animation in every module was dead). Names that start
 * with `qp-` therefore keep their name; everything else is scoped as before.
 */
export function scopedName(name: string, filename: string): string {
  if (name.startsWith('qp-')) return name;
  const hash = createHash('md5').update(filename).digest('base64url').slice(0, 5);
  return `_${name}_${hash}`;
}
