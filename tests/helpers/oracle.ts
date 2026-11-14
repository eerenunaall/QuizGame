import type { TestServer } from './server';

/**
 * White-box peeks into the live server state. Attack scripts use them to *know* what an honest
 * client could not (the correct option), so they can prove what a cheater still cannot change.
 */
export function liveRoom(server: TestServer, roomId: string) {
  const room = server.built.manager.get(roomId);
  if (!room) throw new Error(`room ${roomId} is not live`);
  return room;
}

export function correctOptionId(server: TestServer, roomId: string): string {
  const question = liveRoom(server, roomId).state.game?.round?.question;
  if (!question) throw new Error('no question is being presented');
  return question.correctOptionId;
}

export function wrongOptionId(server: TestServer, roomId: string): string {
  const question = liveRoom(server, roomId).state.game?.round?.question;
  if (!question) throw new Error('no question is being presented');
  const wrong = question.options.find((option) => option.optionId !== question.correctOptionId);
  if (!wrong) throw new Error('no wrong option');
  return wrong.optionId;
}
