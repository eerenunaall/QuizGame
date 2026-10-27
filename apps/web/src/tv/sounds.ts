import type { RoomView } from '@quizparty/protocol';
import { useEffect, useRef } from 'react';
import { sfx } from '../lib/audio';
import { revealPlan } from '../lib/sound/timeline';

/** Longest streak on the board, so a hot streak in the room makes the "correct" cue bigger. */
export function bestStreak(room: RoomView): number {
  return room.game?.scoreboard.reduce((best, entry) => Math.max(best, entry.streak), 0) ?? 0;
}

/**
 * Plays the sound that belongs to each phase when it is entered (and when players arrive or get
 * ready). The reveal is one scored sequence whose timing matches the staggered animation
 * (`revealPlan`); the results play the podium ceremony.
 */
export function useTvSounds(room: RoomView | null): void {
  const lastPhase = useRef<string | null>(null);
  const lastVersion = useRef<number>(-1);
  const lastPlayers = useRef(0);
  const lastReady = useRef(0);
  const lobby = room?.phase === 'LOBBY' || room?.phase === 'WAITING';

  // The lobby bed plays only while people are gathering; it fades out when the game starts.
  useEffect(() => {
    if (lobby) sfx.startAmbience();
    else sfx.stopAmbience();
  }, [lobby]);
  useEffect(() => () => sfx.stopAmbience(), []);

  useEffect(() => {
    if (!room) return;
    if (room.phase === 'LOBBY') {
      if (room.players.length > lastPlayers.current && lastPlayers.current !== 0)
        sfx.play('join', { order: room.players.length - 1 });
      const ready = room.players.filter((player) => player.ready).length;
      if (ready > lastReady.current && room.players.length === lastPlayers.current)
        sfx.play('ready');
      lastReady.current = ready;
    }
    lastPlayers.current = room.players.length;
    if (room.phase === lastPhase.current && room.stateVersion === lastVersion.current) return;
    const entered = room.phase !== lastPhase.current;
    lastPhase.current = room.phase;
    lastVersion.current = room.stateVersion;
    if (!entered) return;
    const data = room.phaseData;
    switch (data.phase) {
      case 'ROUND_INTRO':
        sfx.play('roundStart');
        break;
      case 'FINAL':
        sfx.play('final');
        break;
      case 'RISK_PICK':
      case 'SABOTAGE_PICK':
        // Each timed screen announces itself (ADR-0022).
        sfx.play('stinger');
        break;
      case 'QUESTION':
        sfx.play('question');
        break;
      case 'LOCKED':
        sfx.play('lock');
        break;
      case 'REVEAL': {
        const plan = revealPlan(
          data.options.length,
          data.options.findIndex((option) => option.optionId === data.correctOptionId),
        );
        const correct = data.results.some((result) => result.outcome === 'CORRECT');
        sfx.playReveal(plan, { correct, streak: correct ? bestStreak(room) : 0 });
        break;
      }
      case 'SCORE_UPDATE':
        sfx.play('score');
        break;
      case 'MICRO_INTERMISSION':
        sfx.play('whoosh');
        break;
      case 'RESULTS':
        sfx.playPodium(Math.min(3, data.ranking.length));
        break;
      case 'WAITING':
      case 'LOBBY':
      case 'COUNTDOWN':
      case 'QUESTION_PREP':
      case 'ANSWERING':
      case 'POWER_RESOLUTION':
      case 'ROOM_CLOSED':
        break;
    }
  }, [room]);
}
