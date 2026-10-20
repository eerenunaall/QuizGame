import type { ServerMessage } from '@quizparty/protocol';
import type { TestClient } from './client';

/** Makes a raw test client answer every question as soon as options arrive, choosing option `index`. */
export function autoAnswer(client: TestClient, index: number): () => void {
  return client.subscribe((message: ServerMessage) => {
    if (message.type !== 'PHASE_ENTERED' || message.payload.data.phase !== 'ANSWERING') return;
    const data = message.payload.data;
    client.send('SUBMIT_ANSWER', {
      questionId: data.questionId,
      optionId: data.options[index % data.options.length]!.optionId,
    });
  });
}
