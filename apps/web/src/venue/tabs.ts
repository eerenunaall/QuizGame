import type { MessageKey } from '@quizparty/i18n';
import type { StaffRole } from './api';

/** Icons the panel draws itself (no icon font, no network): see `PanelIcon`. */
export type PanelIconName =
  | 'tables'
  | 'new'
  | 'redeem'
  | 'displays'
  | 'reward'
  | 'entrance'
  | 'look'
  | 'play'
  | 'questions'
  | 'studio'
  | 'quiznight'
  | 'people';

export interface TabDef {
  id: string;
  /** i18n key of the label (both languages exist; a test keeps them in step). */
  label: MessageKey;
  icon: PanelIconName;
  /** Who gets the tab. The server decides again on every call: a hidden tab is convenience only. */
  role: StaffRole;
}

/**
 * THE list of the panel's sections (ADR-0030 §1). A new section is one line here plus its component in
 * `StaffPage.tsx`'s `PANELS`; order is the order on screen. STAFF see the first four and the question counts,
 * the OWNER sees everything.
 */
export const TABS = [
  { id: 'tables', label: 'panel.tab.tables', icon: 'tables', role: 'STAFF' },
  { id: 'new', label: 'panel.tab.new', icon: 'new', role: 'STAFF' },
  { id: 'redeem', label: 'panel.tab.redeem', icon: 'redeem', role: 'STAFF' },
  { id: 'displays', label: 'panel.tab.displays', icon: 'displays', role: 'STAFF' },
  { id: 'reward', label: 'panel.tab.reward', icon: 'reward', role: 'OWNER' },
  { id: 'entrance', label: 'panel.tab.entrance', icon: 'entrance', role: 'OWNER' },
  { id: 'look', label: 'panel.tab.look', icon: 'look', role: 'OWNER' },
  { id: 'play', label: 'panel.tab.play', icon: 'play', role: 'OWNER' },
  // The question counts stay visible to staff (ADR-0025); the answers browser inside is owner-only.
  { id: 'questions', label: 'panel.tab.questions', icon: 'questions', role: 'STAFF' },
  { id: 'studio', label: 'panel.tab.studio', icon: 'studio', role: 'OWNER' },
  // Host-led quiz night (ADR-0029): its own files under venue/quiznight and tv/night.
  { id: 'quiznight', label: 'staff.tab.quiznight', icon: 'quiznight', role: 'OWNER' },
  { id: 'people', label: 'panel.tab.people', icon: 'people', role: 'OWNER' },
] as const satisfies readonly TabDef[];

export type TabId = (typeof TABS)[number]['id'];

export const tabsFor = (role: StaffRole): readonly TabDef[] =>
  TABS.filter((tab) => tab.role === 'STAFF' || role === 'OWNER');
