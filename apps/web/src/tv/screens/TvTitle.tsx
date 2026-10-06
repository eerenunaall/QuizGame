import { useEffect, useRef, useState } from 'react';
import { Backdrop } from '../../ui/Backdrop';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Panel, Pill } from '../../ui/Panel';
import { Sticker } from '../../ui/Sticker';
import { Wordmark } from '../../ui/Wordmark';
import { useI18n } from '../../lib/i18n';
import styles from './TvTitle.module.css';

interface Props {
  creating: boolean;
  error: string | null;
  onStart: () => void;
  volume: number;
  muted: boolean;
  locale: 'tr' | 'en';
  onVolume: (volume: number, muted: boolean) => void;
  onLocale: (locale: 'tr' | 'en') => void;
}

type Dialog = null | 'howto' | 'settings';

const STEPS = [
  { icon: 'cat-general', key: 'tv.howto.step1' },
  { icon: 'rocket', key: 'tv.howto.step2' },
  { icon: 'bullseye', key: 'tv.howto.step3' },
  { icon: 'trophy', key: 'tv.howto.step4' },
] as const;

/** First screen on the TV: wordmark, three big buttons, optional how-to and settings dialogs. */
export function TvTitle({
  creating,
  error,
  onStart,
  volume,
  muted,
  locale,
  onVolume,
  onLocale,
}: Props) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    startRef.current?.focus();
  }, []);

  return (
    <div className={styles.screen}>
      <Backdrop theme="lobby" />
      <div className={styles.hero}>
        <Wordmark tagline={t('brand.tagline.caps')} />
      </div>
      <div className={styles.menu}>
        <Button
          ref={startRef}
          size="xl"
          block
          busy={creating}
          onClick={onStart}
          data-testid="tv-start"
        >
          {creating ? t('tv.connecting') : t('tv.menu.start')}
        </Button>
        <Button variant="violet" size="lg" block onClick={() => setDialog('howto')}>
          {t('tv.menu.howto')}
        </Button>
        <Button variant="ghost" size="lg" block onClick={() => setDialog('settings')}>
          {t('tv.menu.settings')}
        </Button>
      </div>
      <div className={styles.hint}>{t('tv.menu.hint')}</div>
      {error ? (
        <div className={styles.banner}>
          <Banner tone="danger" size="tv">
            {error}
          </Banner>
        </div>
      ) : null}

      {dialog ? (
        <div className={styles.scrim} onClick={() => setDialog(null)}>
          <Panel
            className={styles.dialog}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {dialog === 'howto' ? (
              <>
                <h2 className={styles.dialogTitle}>{t('tv.menu.howto')}</h2>
                <ol className={styles.steps}>
                  {STEPS.map((step, index) => (
                    <li key={step.key} className={styles.step}>
                      <Sticker id={step.icon} size={92} />
                      <span className={styles.stepNumber}>{index + 1}</span>
                      <span className={styles.stepText}>{t(step.key)}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <>
                <h2 className={styles.dialogTitle}>{t('tv.menu.settings')}</h2>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>{t('tv.settings.sound')}</span>
                  <div className={styles.pills}>
                    {[
                      { label: t('common.sound.off'), v: 0, m: true },
                      { label: '50%', v: 0.5, m: false },
                      { label: '100%', v: 1, m: false },
                    ].map((option) => (
                      <Pill
                        key={option.label}
                        selected={option.m ? muted : !muted && Math.abs(volume - option.v) < 0.2}
                        onClick={() => onVolume(option.v, option.m)}
                      >
                        {option.label}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>{t('common.language')}</span>
                  <div className={styles.pills}>
                    <Pill selected={locale === 'tr'} onClick={() => onLocale('tr')}>
                      Türkçe
                    </Pill>
                    <Pill selected={locale === 'en'} onClick={() => onLocale('en')}>
                      English
                    </Pill>
                  </div>
                </div>
              </>
            )}
            <Button size="md" onClick={() => setDialog(null)} className={styles.close} autoFocus>
              {t('common.close')}
            </Button>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
