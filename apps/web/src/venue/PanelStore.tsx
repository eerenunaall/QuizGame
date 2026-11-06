import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '../lib/i18n';
import { venueApi, type SettingsPatch, type VenueSettingsView } from './api';
import { applyVenueLook } from './look';
import styles from './StaffPage.module.css';

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
  undo?: SettingsPatch;
}

interface Store {
  venueId: string;
  settings: VenueSettingsView | null;
  /** Saves a partial change; resolves true when the server accepted it. A toast says what happened. */
  save: (patch: SettingsPatch) => Promise<boolean>;
  /** Replaces the cached settings (an upload changed the venue's images behind this store's back). */
  adopt: (settings: VenueSettingsView) => void;
}

const PanelContext = createContext<Store | null>(null);

export function usePanel(): Store {
  const store = useContext(PanelContext);
  if (!store) throw new Error('usePanel outside PanelProvider');
  return store;
}

/** What `patch` overwrote, in the same shape, so "Geri al" can send it back. */
export function inverse(before: VenueSettingsView, patch: SettingsPatch): SettingsPatch {
  const out: Record<string, unknown> = {};
  const was = before as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const old = was[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      old &&
      typeof old === 'object'
    )
      out[key] = Object.fromEntries(
        Object.keys(value).map((field) => [
          field,
          (old as Record<string, unknown>)[field],
        ]),
      );
    else out[key] = old;
  }
  return out;
}

const TOAST_MS = 7000;

/**
 * The owner's settings for the whole panel: loaded once, saved per section, with a "Kaydedildi" toast
 * that carries an undo. The venue's own theme and accent are applied to the page from here so the panel
 * itself dresses like the TV does (white-label, ADR-0030 §3).
 */
export function PanelProvider({ venueId, children }: { venueId: string; children: ReactNode }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VenueSettingsView | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const current = useRef<VenueSettingsView | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const adopt = useCallback((next: VenueSettingsView): void => {
    current.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    let live = true;
    current.current = null;
    setSettings(null);
    venueApi.settings(venueId).then(
      (result) => {
        if (live) adopt(result.settings);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [venueId, adopt]);

  useEffect(() => {
    if (settings?.look) applyVenueLook(document, settings.look);
  }, [settings?.look]);

  const show = useCallback((next: Omit<Toast, 'id'>): void => {
    if (timer.current) clearTimeout(timer.current);
    counter.current += 1;
    setToast({ ...next, id: counter.current });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  // A toast timer must never fire into an unmounted page.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = useCallback(
    async (patch: SettingsPatch): Promise<boolean> => {
      const before = current.current;
      try {
        const result = await venueApi.saveSettings(venueId, patch);
        adopt(result.settings);
        show({
          text: t('panel.saved'),
          tone: 'ok',
          ...(before ? { undo: inverse(before, patch) } : {}),
        });
        return true;
      } catch {
        show({ text: t('panel.saveFailed'), tone: 'error' });
        return false;
      }
    },
    [venueId, adopt, show, t],
  );

  const undo = (patch: SettingsPatch): void => {
    venueApi.saveSettings(venueId, patch).then(
      (result) => {
        adopt(result.settings);
        show({ text: t('panel.undone'), tone: 'ok' });
      },
      () => show({ text: t('panel.saveFailed'), tone: 'error' }),
    );
  };

  const store = useMemo(
    () => ({ venueId, settings, save, adopt }),
    [venueId, settings, save, adopt],
  );

  return (
    <PanelContext.Provider value={store}>
      {children}
      <div className={styles.toastRegion} role="status" aria-live="polite">
        {toast ? (
          <div
            key={toast.id}
            className={toast.tone === 'ok' ? styles.toast : styles.toastError}
            data-testid="panel-toast"
            data-tone={toast.tone}
          >
            <span>{toast.text}</span>
            {toast.undo ? (
              <button
                type="button"
                className={styles.toastUndo}
                onClick={() => {
                  const patch = toast.undo!;
                  setToast(null);
                  undo(patch);
                }}
                data-testid="panel-undo"
              >
                {t('panel.undo')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </PanelContext.Provider>
  );
}
