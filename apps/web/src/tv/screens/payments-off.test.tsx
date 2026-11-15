import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { player, roomView } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../../lib/i18n';
import { TvLobby } from './TvLobby';

afterEach(cleanup);

const lobby = (paymentsEnabled?: boolean | null, tier: 'FREE' | 'FULL' = 'FREE') =>
  render(
    <I18nProvider locale="tr">
      <TvLobby
        room={roomView({ tier, players: [player(0), player(1)] })}
        joinUrl="https://x.test/join/ABC234"
        joinLabel="x.test/join"
        starting={false}
        error={null}
        onStart={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenUnlock={vi.fn()}
        {...(paymentsEnabled === undefined ? {} : { paymentsEnabled })}
        categoryLabel="Karışık"
      />
    </I18nProvider>,
  );

describe('the TV unlock button follows PAYMENTS_ENABLED (ADR-0030 §6)', () => {
  it('is hidden while payments are off or not yet known', () => {
    lobby(false);
    expect(screen.queryByTestId('lobby-unlock')).toBeNull();
    cleanup();
    lobby(null);
    expect(screen.queryByTestId('lobby-unlock')).toBeNull();
  });

  it('is unchanged with payments on', () => {
    lobby(true);
    expect(screen.getByTestId('lobby-unlock').textContent).toBe('Tam oyunu aç');
  });

  it('keeps the personal-quiz button of an unlocked classic room whatever the flag says', () => {
    lobby(false, 'FULL');
    expect(screen.getByTestId('lobby-unlock')).toBeTruthy();
  });
});
