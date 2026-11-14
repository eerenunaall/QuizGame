import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { StatementForm } from './StatementForm';

afterEach(cleanup);

const mount = (onSubmit: (text: string) => Promise<void>, saved: string | null = null) =>
  render(
    <I18nProvider locale="en">
      <StatementForm saved={saved} onSubmit={onSubmit} />
    </I18nProvider>,
  );
const type = (text: string) =>
  fireEvent.change(screen.getByTestId('ctl-statement-input'), { target: { value: text } });

describe('the Who Said It statement form', () => {
  it('sends the trimmed words once and confirms, then lets the player edit them', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    mount(onSubmit);
    expect(screen.getByTestId<HTMLButtonElement>('ctl-statement-send').disabled).toBe(true);
    type('  midnight pizza  ');
    fireEvent.click(screen.getByTestId('ctl-statement-send'));
    await waitFor(() => expect(screen.getByTestId('ctl-statement-sent')).toBeTruthy());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('midnight pizza');
    type('midnight pizza!');
    expect(screen.queryByTestId('ctl-statement-sent')).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('ctl-statement-send').disabled).toBe(false);
  });

  it('says in plain words why the server refused the text', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce({ code: 'TEXT_REJECTED', params: { reason: 'LINK' } })
      .mockRejectedValueOnce({ code: 'RATE_LIMITED' });
    mount(onSubmit);
    type('see https://x.example');
    fireEvent.click(screen.getByTestId('ctl-statement-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ctl-statement-problem').textContent).toContain('No links'),
    );
    fireEvent.click(screen.getByTestId('ctl-statement-send'));
    await waitFor(() =>
      expect(screen.getByTestId('ctl-statement-problem').textContent).toContain('Too fast'),
    );
  });

  it('shows the words the server already holds after a reload', () => {
    mount(() => Promise.resolve(), 'saved words');
    expect(screen.getByTestId<HTMLTextAreaElement>('ctl-statement-input').value).toBe(
      'saved words',
    );
    expect(screen.getByTestId('ctl-statement-sent')).toBeTruthy();
  });
});
