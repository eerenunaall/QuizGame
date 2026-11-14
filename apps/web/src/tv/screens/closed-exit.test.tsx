import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { TvExitButton, TvExitDialog } from './TvExit';
import { CLOSED_RETURN_MS, TvClosed } from './TvInterstitials';

const wrap = (node: React.ReactElement) => render(<I18nProvider locale="tr">{node}</I18nProvider>);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TvClosed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('says it is returning to the menu and goes there by itself after ~4 s', () => {
    const onMenu = vi.fn();
    wrap(<TvClosed message="Oda kapatıldı." onNew={vi.fn()} onMenu={onMenu} />);
    expect(screen.getByTestId('tv-closed-returning').textContent).toBe('Ana menüye dönülüyor…');
    act(() => void vi.advanceTimersByTime(CLOSED_RETURN_MS - 1));
    expect(onMenu).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('has an "Ana menü" button for an immediate return, focused for the remote', () => {
    const onMenu = vi.fn();
    wrap(<TvClosed message="x" onNew={vi.fn()} onMenu={onMenu} />);
    const button = screen.getByRole('button', { name: 'Ana menü' });
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('starting a new game cancels the automatic return', () => {
    const onMenu = vi.fn();
    const onNew = vi.fn();
    wrap(<TvClosed message="x" onNew={onNew} onMenu={onMenu} />);
    fireEvent.click(screen.getByTestId('tv-closed-new'));
    act(() => void vi.advanceTimersByTime(CLOSED_RETURN_MS * 3));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onMenu).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tv-closed-returning')).toBeNull();
  });

  it('keeps the old behaviour without onMenu: no countdown line, no timer, new game focused', () => {
    const onNew = vi.fn();
    wrap(<TvClosed message="x" onNew={onNew} />);
    expect(screen.queryByTestId('tv-closed-returning')).toBeNull();
    expect(screen.queryByTestId('tv-closed-menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('tv-closed-new'));
  });
});

describe('TV exit control', () => {
  it('shows a small Çıkış button that is focusable by the remote', () => {
    const onClick = vi.fn();
    wrap(<TvExitButton onClick={onClick} />);
    const button = screen.getByTestId('tv-exit');
    expect(button.textContent).toBe('Çıkış');
    expect(button.hasAttribute('data-focusable')).toBe(true);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('asks before closing the room; "Hayır" has the initial focus', () => {
    const onYes = vi.fn();
    const onNo = vi.fn();
    wrap(<TvExitDialog busy={false} error={null} onYes={onYes} onNo={onNo} />);
    const dialog = screen.getByTestId('tv-exit-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Odayı kapat ve ana menüye dön?');
    expect(document.activeElement).toBe(screen.getByTestId('tv-exit-no'));
    fireEvent.click(screen.getByTestId('tv-exit-no'));
    expect(onNo).toHaveBeenCalled();
    expect(onYes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('tv-exit-yes'));
    expect(onYes).toHaveBeenCalledTimes(1);
  });
});
