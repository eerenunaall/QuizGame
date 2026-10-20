import { ScrollView } from 'react-native';
import type { PurchaseState } from '../core/purchases';
import { Body, Button, ErrorText, Panel, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { describeFailure } from './errors';

/**
 * The full-game purchase. The price text is the store's; the tier shown is the server's. Flow A/B
 * entry (ADR-0013): buying needs an account so the purchase is bound to it.
 */
export function PurchaseScreen({
  state,
  signedIn,
  onBuy,
  onRestore,
  onSignIn,
}: {
  state: PurchaseState;
  signedIn: boolean;
  onBuy: () => void;
  onRestore: () => void;
  onSignIn: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const working =
    state.status === 'BUYING' || state.status === 'RESTORING' || state.status === 'LOADING';
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} testID="purchase">
      <Title>{t('purchase.title')}</Title>
      <Body>{t('purchase.intro')}</Body>
      {state.tier === 'FULL' ? (
        <Panel>
          <Body tone="good" testID="purchase-owned">
            {t('m.purchase.owned')}
          </Body>
        </Panel>
      ) : (
        <>
          {state.product ? (
            <Body testID="purchase-price">
              {t('m.purchase.price', { price: state.product.displayPrice })}
            </Body>
          ) : null}
          {!state.storeAvailable ? <Body tone="muted">{t('m.purchase.unavailable')}</Body> : null}
          {!signedIn ? (
            <>
              <Body tone="muted">{t('m.purchase.needSignIn')}</Body>
              <Button testID="purchase-signin" label={t('m.signin.title')} onPress={onSignIn} />
            </>
          ) : (
            <Button
              big
              testID="purchase-buy"
              label={state.status === 'BUYING' ? t('m.purchase.working') : t('m.purchase.buy')}
              busy={state.status === 'BUYING'}
              disabled={working || !state.storeAvailable}
              onPress={onBuy}
            />
          )}
        </>
      )}
      {signedIn ? (
        <Button
          testID="purchase-restore"
          variant="ghost"
          label={t('m.purchase.restore')}
          busy={state.status === 'RESTORING'}
          disabled={working}
          onPress={onRestore}
        />
      ) : null}
      {state.status === 'PENDING' ? (
        <Body tone="muted" testID="purchase-pending">
          {t('m.purchase.pending')}
        </Body>
      ) : null}
      {state.status === 'FAILED' && state.errorCode ? (
        <ErrorText testID="purchase-error">
          {describeFailure(i18n, { code: state.errorCode })}
        </ErrorText>
      ) : null}
      {state.restored === 'RESTORED' ? <Body tone="good">{t('m.purchase.restored')}</Body> : null}
      {state.restored === 'NOTHING' ? (
        <Body tone="muted">{t('m.purchase.nothingToRestore')}</Body>
      ) : null}
      <Body tone="muted">{t('purchase.privacy')}</Body>
    </ScrollView>
  );
}
