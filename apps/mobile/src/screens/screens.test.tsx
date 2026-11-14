import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { roomView, stateWith } from '@quizparty/controller-client/fixtures';
import type { ClientState } from '@quizparty/controller-client';
import { INITIAL_PURCHASE_STATE, type PurchaseState } from '../core/purchases';
import { renderLocalized } from '../testing/render';
import { HomeScreen } from './HomeScreen';
import { JoinScreen } from './JoinScreen';
import { InvalidLinkScreen, UnlockScreen } from './LinkScreens';
import { ProfileScreen } from './ProfileScreen';
import { ReconnectBanner, bannerKind } from './ReconnectBanner';
import { PurchaseScreen } from './PurchaseScreen';
import { SignInForm } from './SignInForm';

describe('Home', () => {
  const handlers = () => ({
    onJoin: jest.fn(),
    onResume: jest.fn(),
    onFullGame: jest.fn(),
    onProfile: jest.fn(),
    onToggleLocale: jest.fn(),
  });
  it('offers join, the full game and the account', async () => {
    const h = handlers();
    await renderLocalized(<HomeScreen resumeCode={null} {...h} />);
    expect(screen.getByText('Odaya katıl')).toBeTruthy();
    expect(screen.queryByTestId('home-resume')).toBeNull();
    await fireEvent.press(screen.getByTestId('home-join'));
    await fireEvent.press(screen.getByTestId('home-full'));
    await fireEvent.press(screen.getByTestId('home-profile'));
    expect(h.onJoin).toHaveBeenCalled();
    expect(h.onFullGame).toHaveBeenCalled();
    expect(h.onProfile).toHaveBeenCalled();
  });
  it('offers to return to a stored seat', async () => {
    const h = handlers();
    await renderLocalized(<HomeScreen resumeCode="ABC234" {...h} />, 'en');
    await fireEvent.press(screen.getByText('Back to your room (ABC234)'));
    expect(h.onResume).toHaveBeenCalledWith('ABC234');
  });
});

describe('Join', () => {
  const base = {
    initialCode: '',
    initialNickname: '',
    initialAvatar: 'fox' as const,
    joining: false,
    error: null,
  };

  it('joins with a normalised code, trimmed nickname and the chosen avatar', async () => {
    const onSubmit = jest.fn();
    await renderLocalized(<JoinScreen {...base} onSubmit={onSubmit} />);
    expect(screen.getByTestId('join-submit').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('join-code'), 'abc234');
    await fireEvent.changeText(screen.getByTestId('join-nickname'), '  Ece ');
    await fireEvent.press(screen.getByTestId('avatar-panda'));
    await fireEvent.press(screen.getByTestId('join-submit'));
    expect(onSubmit).toHaveBeenCalledWith('ABC234', 'Ece', 'panda');
  });

  it('a deep link prefills the code', async () => {
    await renderLocalized(<JoinScreen {...base} initialCode="ABC234" onSubmit={jest.fn()} />);
    expect(screen.getByTestId('join-code').props.value).toBe('ABC234');
  });

  it('refuses a malformed code before any request', async () => {
    const onSubmit = jest.fn();
    await renderLocalized(
      <JoinScreen {...base} initialNickname="Ece" initialCode="ABC10O" onSubmit={onSubmit} />,
    );
    expect(screen.getByText('Kod 6 karakter olmalı.')).toBeTruthy();
    expect(screen.getByTestId('join-submit').props.accessibilityState.disabled).toBe(true);
  });

  it.each([
    [null, 'Bu oda bulunamadı. Kodu kontrol et.'],
    [
      { code: 'ABC234', joinable: false, phase: 'IN_GAME', playerCount: 2, maxPlayers: 8 },
      'Oyun başladı. Bir sonraki oyunda katılabilirsin.',
    ],
    [
      { code: 'ABC234', joinable: false, phase: 'LOBBY', playerCount: 8, maxPlayers: 8 },
      'Bu oda dolu.',
    ],
  ] as const)('room lookup %j shows a note and blocks joining', async (preview, note) => {
    await renderLocalized(
      <JoinScreen
        {...base}
        initialCode="ABC234"
        initialNickname="Ece"
        preview={preview}
        onSubmit={jest.fn()}
      />,
    );
    expect(screen.getByText(note)).toBeTruthy();
    expect(screen.getByTestId('join-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the join error and busy state', async () => {
    await renderLocalized(
      <JoinScreen {...base} joining error="Bu takma ad odada kullanılıyor." onSubmit={jest.fn()} />,
    );
    expect(screen.getByText('Bu takma ad odada kullanılıyor.')).toBeTruthy();
  });
});

describe('Reconnect banner', () => {
  const live = (patch: Partial<ClientState> = {}, roomPatch = {}): ClientState =>
    stateWith(roomView({ phase: 'ANSWERING', ...roomPatch }), patch);

  it('maps client state to the right notice', () => {
    expect(bannerKind(live(), false)).toBeNull();
    expect(bannerKind(live({ transport: 'RECONNECTING' }), false)).toBe('RECONNECTING');
    expect(bannerKind(live({}, { displayConnected: false }), false)).toBe('TV_LOST');
    expect(bannerKind(live({}, { displayConnected: false, phase: 'LOBBY' }), false)).toBeNull();
    expect(bannerKind(live(), true)).toBe('RESTORED');
    // reconnecting beats everything
    expect(bannerKind(live({ transport: 'RECONNECTING' }, { displayConnected: false }), true)).toBe(
      'RECONNECTING',
    );
  });

  it.each([
    ['RECONNECTING', 'Yeniden bağlanıyor…'],
    ['TV_LOST', 'TV bağlantısı bekleniyor…'],
    ['RESTORED', 'Oyun durumu geri yüklendi.'],
  ] as const)('%s renders its copy as a live-region alert', async (kind, text) => {
    await renderLocalized(<ReconnectBanner kind={kind} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByTestId(`banner-${kind}`).props.accessibilityRole).toBe('alert');
  });

  it('renders nothing when connected', async () => {
    await renderLocalized(<ReconnectBanner kind={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Purchase', () => {
  const handlers = () => ({ onBuy: jest.fn(), onRestore: jest.fn(), onSignIn: jest.fn() });
  const state = (patch: Partial<PurchaseState> = {}): PurchaseState => ({
    ...INITIAL_PURCHASE_STATE,
    product: { id: 'quizparty_full_game', displayPrice: '₺149,99', title: 'Full' },
    ...patch,
  });

  it('shows the store price and buys when signed in', async () => {
    const h = handlers();
    await renderLocalized(<PurchaseScreen state={state()} signedIn {...h} />);
    expect(screen.getByText('Fiyat: ₺149,99')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('purchase-buy'));
    await fireEvent.press(screen.getByTestId('purchase-restore'));
    expect(h.onBuy).toHaveBeenCalled();
    expect(h.onRestore).toHaveBeenCalled();
  });

  it('asks to sign in first: the purchase is bound to an account', async () => {
    const h = handlers();
    await renderLocalized(<PurchaseScreen state={state()} signedIn={false} {...h} />);
    expect(screen.queryByTestId('purchase-buy')).toBeNull();
    await fireEvent.press(screen.getByTestId('purchase-signin'));
    expect(h.onSignIn).toHaveBeenCalled();
  });

  it('shows ownership as the server reported it', async () => {
    await renderLocalized(
      <PurchaseScreen state={state({ tier: 'FULL', status: 'OWNED' })} signedIn {...handlers()} />,
    );
    expect(screen.getByTestId('purchase-owned')).toBeTruthy();
    expect(screen.queryByTestId('purchase-buy')).toBeNull();
  });

  it("maps a failure to local copy, never the server's text", async () => {
    await renderLocalized(
      <PurchaseScreen
        state={state({ status: 'FAILED', errorCode: 'PURCHASE_ACCOUNT_MISMATCH' })}
        signedIn
        {...handlers()}
      />,
    );
    expect(screen.getByText('Bu satın alma başka bir hesaba ait.')).toBeTruthy();
  });

  it('shows a calm note for a payment awaiting approval', async () => {
    await renderLocalized(
      <PurchaseScreen state={state({ status: 'PENDING' })} signedIn {...handlers()} />,
    );
    expect(screen.getByTestId('purchase-pending')).toBeTruthy();
  });

  it('disables buying while a purchase is in flight', async () => {
    await renderLocalized(
      <PurchaseScreen state={state({ status: 'BUYING' })} signedIn {...handlers()} />,
    );
    expect(screen.getByTestId('purchase-buy').props.accessibilityState.disabled).toBe(true);
  });

  it('explains an unavailable store (simulator)', async () => {
    await renderLocalized(
      <PurchaseScreen
        state={state({ storeAvailable: false, product: null })}
        signedIn
        {...handlers()}
      />,
    );
    expect(screen.getByText('Mağaza bu cihazda kullanılamıyor.')).toBeTruthy();
    expect(screen.getByTestId('purchase-buy').props.accessibilityState.disabled).toBe(true);
  });
});

describe('Sign-in form', () => {
  it('two steps: email then the six-digit code', async () => {
    const requestCode = jest.fn<(email: string) => Promise<void>>(() => Promise.resolve());
    const verifyCode = jest.fn<(email: string, code: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    await renderLocalized(<SignInForm requestCode={requestCode} verifyCode={verifyCode} />);
    await fireEvent.changeText(screen.getByTestId('signin-email'), 'bad');
    await fireEvent.press(screen.getByTestId('signin-send'));
    expect(requestCode).not.toHaveBeenCalled();
    expect(screen.getByText('Geçerli bir e-posta adresi yaz.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('signin-email'), 'ece@example.com');
    await fireEvent.press(screen.getByTestId('signin-send'));
    await waitFor(() => expect(screen.getByTestId('signin-code')).toBeTruthy());
    expect(requestCode).toHaveBeenCalledWith('ece@example.com');

    await fireEvent.changeText(screen.getByTestId('signin-code'), '12a345 6');
    expect(screen.getByTestId('signin-code').props.value).toBe('123456');
    await fireEvent.press(screen.getByTestId('signin-verify'));
    expect(verifyCode).toHaveBeenCalledWith('ece@example.com', '123456');
  });

  it('a wrong code shows the same generic refusal', async () => {
    const verifyCode = jest.fn(() =>
      Promise.reject(Object.assign(new Error('x'), { code: 'UNAUTHORIZED' })),
    );
    await renderLocalized(
      <SignInForm requestCode={() => Promise.resolve()} verifyCode={verifyCode} />,
    );
    await fireEvent.changeText(screen.getByTestId('signin-email'), 'ece@example.com');
    await fireEvent.press(screen.getByTestId('signin-send'));
    await waitFor(() => screen.getByTestId('signin-code'));
    await fireEvent.changeText(screen.getByTestId('signin-code'), '000000');
    await fireEvent.press(screen.getByTestId('signin-verify'));
    await waitFor(() =>
      expect(screen.getByText('Kod doğru değil ya da süresi doldu.')).toBeTruthy(),
    );
  });
});

describe('Profile shell', () => {
  const account = {
    id: 'a',
    email: 'ece@example.com',
    displayName: null,
    locale: 'tr',
    roles: [],
    sessionKind: 'MOBILE',
  };
  const props = () => ({
    tier: 'FREE' as const,
    hapticsOn: true,
    requestCode: jest.fn<(email: string) => Promise<void>>(() => Promise.resolve()),
    verifyCode: jest.fn<(email: string, code: string) => Promise<void>>(() => Promise.resolve()),
    onSignOut: jest.fn(() => Promise.resolve()),
    onExport: jest.fn(() => Promise.resolve()),
    onDelete: jest.fn(() => Promise.resolve()),
    onToggleHaptics: jest.fn(),
  });

  it('signed out: shows the email sign-in', async () => {
    await renderLocalized(<ProfileScreen account={null} {...props()} />);
    expect(screen.getByTestId('signin')).toBeTruthy();
    expect(screen.queryByTestId('profile-delete')).toBeNull();
  });

  it('signed in: shows the account, exports and signs out', async () => {
    const p = props();
    await renderLocalized(<ProfileScreen account={account} {...p} />);
    expect(screen.getByText('ece@example.com olarak giriş yaptın.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-export'));
    await waitFor(() => expect(p.onExport).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('profile-message')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('profile-signout'));
    await waitFor(() => expect(p.onSignOut).toHaveBeenCalled());
  });

  it('delete account needs a second, explicit confirmation', async () => {
    const p = props();
    await renderLocalized(<ProfileScreen account={account} {...p} />);
    await fireEvent.press(screen.getByTestId('profile-delete'));
    expect(p.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/geri alınamaz/u)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-delete-confirm'));
    await waitFor(() => expect(p.onDelete).toHaveBeenCalledTimes(1));
  });

  it('a failed delete shows mapped copy and keeps the account', async () => {
    const p = {
      ...props(),
      onDelete: jest.fn(() => Promise.reject(Object.assign(new Error('x'), { code: 'FORBIDDEN' }))),
    };
    await renderLocalized(<ProfileScreen account={account} {...p} />);
    await fireEvent.press(screen.getByTestId('profile-delete'));
    await fireEvent.press(screen.getByTestId('profile-delete-confirm'));
    await waitFor(() => expect(screen.getByText('Bunu yapamazsın.')).toBeTruthy());
  });
});

describe('Link screens', () => {
  it('invalid link lands on a safe screen with a way home', async () => {
    const onHome = jest.fn();
    await renderLocalized(<InvalidLinkScreen onHome={onHome} />);
    expect(screen.getByText('Bu bağlantı geçerli değil')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('link-home'));
    expect(onHome).toHaveBeenCalled();
  });

  it.each([
    ['NEED_SIGN_IN', 'unlock-signin'],
    ['READY', 'unlock-claim'],
    ['DONE', 'unlock-done'],
    ['NOT_OWNED', 'unlock-not-owned'],
    ['DEAD', 'unlock-dead'],
  ] as const)('unlock %s', async (status, testId) => {
    await renderLocalized(
      <UnlockScreen
        status={status}
        roomCode="ABC234"
        onClaim={jest.fn()}
        onSignIn={jest.fn()}
        onBuy={jest.fn()}
      />,
    );
    expect(screen.getByTestId(testId)).toBeTruthy();
  });
});
