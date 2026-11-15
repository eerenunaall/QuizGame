import type { AvatarId } from '@quizparty/protocol/constants';

/** Native avatars are system emoji; the record is exhaustive, so a new avatar id breaks the build here. */
export const AVATAR_EMOJI: Record<AvatarId, string> = {
  fox: '🦊',
  panda: '🐼',
  owl: '🦉',
  cat: '🐱',
  dog: '🐶',
  rabbit: '🐰',
  tiger: '🐯',
  koala: '🐨',
  penguin: '🐧',
  frog: '🐸',
  lion: '🦁',
  monkey: '🐵',
  bear: '🐻',
  unicorn: '🦄',
  dragon: '🐲',
  robot: '🤖',
  octopus: '🐙',
  alien: '👽',
  ghost: '👻',
  cool: '😎',
  nerd: '🤓',
  cowboy: '🤠',
  chick: '🐥',
  whale: '🐳',
};
