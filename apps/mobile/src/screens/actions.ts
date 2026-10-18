import type { DifficultyPreset } from '@quizparty/protocol';
import type { PrepChoice } from '@quizparty/controller-client';

/** Everything the controller screens can ask for; the container binds these to the shared `GameClient`. */
export interface ControllerActions {
  ready: (ready: boolean) => void;
  start: () => void;
  settings: (change: { rounds?: number; difficulty?: DifficultyPreset }) => void;
  answer: (optionId: string) => void;
  rematch: () => void;
  backToLobby: () => void;
  leave: () => void;
  /** QUESTION_PREP: stake, Double Down and sabotage in one final message. Rejects with the server's code. */
  commit: (choice: PrepChoice) => Promise<void>;
  fifty: () => void;
  /** Who Said It, lobby: the player's one statement. Rejects with the server's code. */
  submitStatement: (text: string) => Promise<void>;
  /** Optional feedback; absent when the player turned it off. */
  haptic?: ((kind: 'tap' | 'lock' | 'correct' | 'wrong') => void) | undefined;
}
