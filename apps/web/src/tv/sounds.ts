import type { RoomView } from '@quizparty/protocol';
import { useEffect, useRef } from 'react';
import { sfx } from '../lib/audio';

/** Plays the sound that belongs to each phase when it is entered (and when players arrive). */
export function useTvSounds(room: RoomView | null): void {
  const lastPhase = useRef<string | null>(null);
  const lastVersion = useRef<number>(-1);
  const lastPlayers = useRef(0);
  useEffect(() => {
    if (!room) return;
    if (
      room.phase === 'LOBBY' &&
      room.players.length > lastPlayers.current &&
      lastPlayers.current !== 0
    )
      sfx.play('join');
    lastPlayers.current = room.players.length;
    if (room.phase === lastPhase.current && room.stateVersion === lastVersion.current) return;
    const entered = room.phase !== lastPhase.current;
    lastPhase.current = room.phase;
    lastVersion.current = room.stateVersion;
    if (!entered) return;
    const data = room.phaseData;
    switch (data.phase) {
      case 'ROUND_INTRO':
        sfx.play('whoosh');
        break;
      case 'FINAL':
        sfx.play('final');
        break;
      case 'QUESTION':
        sfx.play('question');
        break;
      case 'LOCKED':
        sfx.play('lock');
        break;
      case 'REVEAL':
        sfx.play('reveal');
        window.setTimeout(
          () =>
            sfx.play(
              data.results.some((result) => result.outcome === 'CORRECT') ? 'correct' : 'wrong',
            ),
          520,
        );
        break;
      case 'SCORE_UPDATE':
        sfx.play('score');
        break;
      case 'RESULTS':
        sfx.play('fanfare');
        break;
      case 'WAITING':
      case 'LOBBY':
      case 'COUNTDOWN':
      case 'QUESTION_PREP':
      case 'ANSWERING':
      case 'POWER_RESOLUTION':
      case 'MICRO_INTERMISSION':
      case 'ROOM_CLOSED':
        break;
    }
  }, [room]);
}
