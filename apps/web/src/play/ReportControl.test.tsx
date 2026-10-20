import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUESTION_REPORT_REASONS } from '@quizparty/protocol/constants';
import { I18nProvider } from '../lib/i18n';
import { ReportControl } from './ReportControl';

afterEach(cleanup);

const mount = (
  report: (questionId: string, reason: string) => Promise<void>,
  locale: 'tr' | 'en' = 'tr',
) =>
  render(
    <I18nProvider locale={locale}>
      <ReportControl questionId="q-1" report={report as never} />
    </I18nProvider>,
  );

describe('reporting a question from the phone', () => {
  it('starts as one quiet link, opens the reasons, sends the chosen one for this question and says thanks', async () => {
    const report = vi.fn(() => Promise.resolve());
    mount(report);
    expect(screen.queryByTestId('ctl-report-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('ctl-report-open'));
    expect(screen.getByTestId('ctl-report-sheet')).toBeTruthy();
    // Every reason of the protocol is offered, and nothing else (no text field).
    for (const reason of QUESTION_REPORT_REASONS)
      expect(screen.getByTestId(`ctl-report-${reason}`)).toBeTruthy();
    expect(document.querySelector('input, textarea')).toBeNull();
    fireEvent.click(screen.getByTestId('ctl-report-WRONG_ANSWER'));
    await waitFor(() => expect(screen.getByTestId('ctl-report-sent')).toBeTruthy());
    expect(report).toHaveBeenCalledExactlyOnceWith('q-1', 'WRONG_ANSWER');
    expect(screen.queryByTestId('ctl-report-sheet')).toBeNull();
  });

  it("shows the server's refusal in plain words and lets the player try again", async () => {
    const report = vi
      .fn()
      .mockRejectedValueOnce({ code: 'RATE_LIMITED' })
      .mockResolvedValueOnce(undefined);
    mount(report);
    fireEvent.click(screen.getByTestId('ctl-report-open'));
    fireEvent.click(screen.getByTestId('ctl-report-TYPO'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Çok hızlısın'));
    fireEvent.click(screen.getByTestId('ctl-report-TYPO'));
    await waitFor(() => expect(screen.getByTestId('ctl-report-sent')).toBeTruthy());
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('speaks English when the phone does', () => {
    mount(() => Promise.resolve(), 'en');
    expect(screen.getByTestId('ctl-report-open').textContent).toBe('Report question');
  });

  it('does not let a second tap send twice while the first is on its way', async () => {
    let finish: () => void = () => undefined;
    const report = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mount(report);
    fireEvent.click(screen.getByTestId('ctl-report-open'));
    fireEvent.click(screen.getByTestId('ctl-report-OFFENSIVE'));
    fireEvent.click(screen.getByTestId('ctl-report-OFFENSIVE'));
    expect(report).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByTestId('ctl-report-sent')).toBeTruthy());
  });
});
