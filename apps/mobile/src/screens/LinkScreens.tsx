import { Body, Button, Center, ErrorText, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';

/** Safe landing for a link that failed validation (ADR-0017): says nothing about why. */
export function InvalidLinkScreen({ onHome }: { onHome: () => void }) {
  const { t } = useI18n();
  return (
    <Center testID="link-invalid">
      <Title>{t('m.link.invalid.title')}</Title>
      <Body tone="muted">{t('m.link.invalid.body')}</Body>
      <Button big label={t('m.link.invalid.home')} onPress={onHome} testID="link-home" />
    </Center>
  );
}

export type UnlockStatus = 'READY' | 'WORKING' | 'DONE' | 'NOT_OWNED' | 'DEAD' | 'NEED_SIGN_IN';

/** TV unlock link (ADR-0013 flow A): signed-in owner attaches the full game to the room. */
export function UnlockScreen({
  status,
  roomCode,
  onClaim,
  onSignIn,
  onBuy,
  errorText,
}: {
  status: UnlockStatus;
  roomCode: string | null;
  onClaim: () => void;
  onSignIn: () => void;
  onBuy: () => void;
  errorText?: string | null;
}) {
  const { t } = useI18n();
  return (
    <Center testID="unlock">
      <Title>{t('unlock.title')}</Title>
      {roomCode ? <Body tone="muted">{t('unlock.room', { code: roomCode })}</Body> : null}
      {status === 'NEED_SIGN_IN' ? (
        <>
          <Body>{t('m.unlock.signInFirst')}</Body>
          <Button big label={t('m.signin.title')} onPress={onSignIn} testID="unlock-signin" />
        </>
      ) : null}
      {status === 'READY' || status === 'WORKING' ? (
        <Button
          big
          label={t('unlock.link')}
          busy={status === 'WORKING'}
          onPress={onClaim}
          testID="unlock-claim"
        />
      ) : null}
      {status === 'DONE' ? (
        <Body tone="good" testID="unlock-done">
          {t('unlock.success')}
        </Body>
      ) : null}
      {status === 'NOT_OWNED' ? (
        <>
          <Body testID="unlock-not-owned">{t('m.unlock.buyFirst')}</Body>
          <Button big label={t('m.purchase.buy')} onPress={onBuy} testID="unlock-buy" />
        </>
      ) : null}
      {status === 'DEAD' ? <ErrorText testID="unlock-dead">{t('unlock.dead')}</ErrorText> : null}
      {errorText ? <ErrorText>{errorText}</ErrorText> : null}
    </Center>
  );
}
