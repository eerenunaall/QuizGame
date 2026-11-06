import type { DifficultyPreset } from '@quizparty/protocol';
import type { RiskChoice, SabotageChoice } from '@quizparty/controller-client';

/** Everything the controller screens can ask for; the container binds these to the shared `GameClient`. */
export interface ControllerActions {
  ready: (ready: boolean) => void;
  start: () => void;
  settings: (change: { rounds?: number; difficulty?: DifficultyPreset }) => void;
  answer: (optionId: string) => void;
  rematch: () => void;
  backToLobby: () => void;
  leave: () => void;
  /** RISK_PICK: stake and Double Down in one final message. Rejects with the server's code. */
  commitRisk: (choice: RiskChoice) => Promise<void>;
  /** RISK_PICK: accept or decline a Duel challenge (ADR-0023). Rejects with the server's code. */
  respondDuel?: (challengerId: string, accept: boolean) => Promise<void>;
  /** SABOTAGE_PICK: one sabotage, or none (`null`), in one final message. Rejects with the server's code. */
  commitSabotage: (choice: SabotageChoice) => Promise<void>;
  fifty: () => void;
  /** Who Said It, lobby: the player's one statement. Rejects with the server's code. */
  submitStatement: (text: string) => Promise<void>;
  /** Optional feedback; absent when the player turned it off. */
  haptic?: ((kind: 'tap' | 'lock' | 'correct' | 'wrong') => void) | undefined;
}
