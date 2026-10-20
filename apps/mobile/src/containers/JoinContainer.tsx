import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import type { RoomPreview } from '@quizparty/protocol';
import { parseRoomCode } from '@quizparty/shared';
import { loadProfile, randomAvatar, saveProfile, type Profile } from '../core/profile';
import { useApp } from '../native/AppProviders';
import { JoinScreen } from '../screens/JoinScreen';
import { describeJoinFailure } from '../screens/errors';
import { useI18n } from '../ui/i18n';

/** Join by code (typed, or filled in by a deep / universal link). */
export function JoinContainer({ code }: { code: string }) {
  const { runtime, haptic } = useApp();
  const i18n = useI18n();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fallbackAvatar] = useState(() => randomAvatar());
  const [preview, setPreview] = useState<RoomPreview | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadProfile(runtime.storage).then(setProfile);
  }, [runtime]);

  // Look the room up for a valid prefilled code so "full" / "started" show before typing a nickname.
  useEffect(() => {
    const parsed = parseRoomCode(code);
    if (!parsed) return undefined;
    let cancelled = false;
    runtime.client
      .preview(parsed)
      .then((found) => !cancelled && setPreview(found))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runtime, code]);

  const submit = (roomCode: string, nickname: string, avatarId: Profile['avatarId']): void => {
    setJoining(true);
    setError(null);
    runtime.client
      .join(roomCode, nickname, avatarId)
      .then(async () => {
        await saveProfile(runtime.storage, { nickname, avatarId });
        await runtime.storage.set('qp.lastRoom', roomCode);
        haptic?.('lock');
        router.replace(`/room/${roomCode}`);
      })
      .catch((cause: unknown) => setError(describeJoinFailure(i18n, cause)))
      .finally(() => setJoining(false));
  };

  return (
    <JoinScreen
      key={profile ? 'loaded' : 'loading'}
      initialCode={code}
      initialNickname={profile?.nickname ?? ''}
      initialAvatar={profile?.avatarId ?? fallbackAvatar}
      preview={preview}
      joining={joining}
      error={error}
      onSubmit={submit}
    />
  );
}
