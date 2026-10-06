import { useEffect, useState } from 'react';
import { validateNicknameShape } from '@quizparty/validation/nickname-core';
import { AVATAR_IDS, type AvatarId } from '@quizparty/protocol/constants';
import type { RoomPreview } from '@quizparty/protocol';
import { Avatar } from '../ui/Avatar';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Sticker } from '../ui/Sticker';
import { useI18n } from '../lib/i18n';
import styles from './JoinForm.module.css';
import { cx } from '../lib/cx';

interface Props {
  code: string;
  preview: RoomPreview | null | 'loading';
  initialNickname: string;
  initialAvatar: AvatarId;
  joining: boolean;
  /** Server error to show (already localised). */
  error: string | null;
  onSubmit: (nickname: string, avatarId: AvatarId) => void;
}

/** Nickname + character, with the same rules as the server so mistakes are caught before sending. */
export function JoinForm({
  code,
  preview,
  initialNickname,
  initialAvatar,
  joining,
  error,
  onSubmit,
}: Props) {
  const { t, td } = useI18n();
  const [nickname, setNickname] = useState(initialNickname);
  const [avatarId, setAvatarId] = useState<AvatarId>(initialAvatar);
  const [touched, setTouched] = useState(false);

  useEffect(() => setNickname(initialNickname), [initialNickname]);

  const checked = validateNicknameShape(nickname);
  const hint = touched && !checked.ok ? td(`nickname.reason.${checked.reason}`) : null;
  const blocked =
    preview !== 'loading' &&
    preview !== null &&
    (!preview.joinable || preview.playerCount >= preview.maxPlayers);
  const previewMessage =
    preview === null
      ? t('join.preview.missing')
      : preview !== 'loading' && !preview.joinable
        ? t('join.preview.started')
        : blocked
          ? t('join.preview.full')
          : null;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (checked.ok && !blocked && preview !== null) onSubmit(checked.nickname, avatarId);
      }}
    >
      <div className={styles.head}>
        <Sticker id="party-popper" size={64} />
        <div className={styles.title}>{t('join.title')}</div>
        <div className={styles.room}>
          {t('join.room')}: <strong data-testid="join-room">{code}</strong>
        </div>
      </div>

      {previewMessage ? (
        <div className={styles.banner}>
          <Banner tone="danger">{previewMessage}</Banner>
        </div>
      ) : null}

      <label className={styles.label} htmlFor="nickname">
        {t('join.nickname')}
      </label>
      <input
        id="nickname"
        className={styles.input}
        value={nickname}
        placeholder={t('join.nickname.placeholder')}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        maxLength={24}
        enterKeyHint="go"
        onChange={(event) => {
          setNickname(event.target.value);
          setTouched(true);
        }}
        aria-invalid={hint ? true : undefined}
        data-testid="join-nickname"
      />
      <div className={styles.hint} role="alert">
        {hint}
      </div>

      <div className={styles.label}>{t('join.avatar')}</div>
      <div className={styles.avatars} role="radiogroup" aria-label={t('join.avatar')}>
        {AVATAR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={avatarId === id}
            aria-label={td(`avatar.${id}`)}
            className={cx(styles.avatar, avatarId === id && styles.picked)}
            onClick={() => setAvatarId(id)}
            data-testid={`avatar-${id}`}
          >
            <Avatar avatarId={id} size={56} />
          </button>
        ))}
      </div>

      {error ? (
        <div className={styles.banner}>
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : null}

      <div className={styles.submit}>
        <Button
          type="submit"
          size="lg"
          block
          busy={joining}
          disabled={blocked || preview === null}
          data-testid="join-submit"
        >
          {joining ? t('join.joining') : t('join.submit')}
        </Button>
      </div>
    </form>
  );
}
