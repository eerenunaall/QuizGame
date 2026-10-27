import { AVATAR_IDS, type AvatarId } from '@quizparty/protocol/constants';
import type { KeyValueStorage } from '@quizparty/controller-client';

/** Nickname + avatar remembered on this device (the same record the browser controller keeps). */
export interface Profile {
  nickname: string;
  avatarId: AvatarId;
}

const KEY = 'qp.profile';

export function parseProfile(raw: string | null): Profile | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Profile>;
    if (typeof value.nickname === 'string' && AVATAR_IDS.includes(value.avatarId as AvatarId))
      return { nickname: value.nickname, avatarId: value.avatarId as AvatarId };
  } catch {
    // corrupt data is ignored
  }
  return null;
}

export async function loadProfile(storage: KeyValueStorage): Promise<Profile | null> {
  return parseProfile(await storage.get(KEY));
}

export async function saveProfile(storage: KeyValueStorage, profile: Profile): Promise<void> {
  await storage.set(KEY, JSON.stringify(profile));
}

export function randomAvatar(random: () => number = Math.random): AvatarId {
  return AVATAR_IDS[Math.floor(random() * AVATAR_IDS.length)] ?? 'fox';
}
