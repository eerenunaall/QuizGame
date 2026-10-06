import { scanForbiddenKeys, type Phase, type ServerMessage } from '@quizparty/protocol';
import type { TestClient } from './client';

const POST_REVEAL: ReadonlySet<Phase> = new Set(['REVEAL', 'POWER_RESOLUTION', 'SCORE_UPDATE']);

/**
 * Walks everything a client received and returns forbidden-key hits found in frames that were
 * delivered while the room was *before* the reveal of the current question (GDD §11, ADR-0008).
 */
export function preRevealLeaks(client: TestClient): string[] {
  const leaks: string[] = [];
  let phase: Phase = 'LOBBY';
  client.messages.forEach((message: ServerMessage, index) => {
    const payload = message.payload as { data?: { phase: Phase }; room?: { phase: Phase } };
    if (message.type === 'PHASE_ENTERED') phase = (payload.data as { phase: Phase }).phase;
    else if (payload.room) phase = payload.room.phase;
    if (POST_REVEAL.has(phase)) return;
    for (const hit of scanForbiddenKeys(message.payload)) {
      leaks.push(`#${index} ${message.type} in ${phase}: ${hit.path}`);
    }
  });
  return leaks;
}
