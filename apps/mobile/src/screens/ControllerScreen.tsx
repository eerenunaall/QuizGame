import { Text } from 'react-native';
import type { ClientState } from '@quizparty/controller-client';
import { AnswerView } from './AnswerView';
import { LobbyView } from './LobbyView';
import { RiskView, SabotageView } from './PickViews';
import { ResultsView, RevealView, ScoreView } from './ResultsViews';
import type { ControllerActions } from './actions';
import { Body, Button, Center, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';

/**
 * Chooses the controller screen for the room's phase: the native twin of the browser
 * `Controller`. It renders what the server sent and holds no game rules (ADR-0005/0008).
 */
export function ControllerScreen({
  state,
  now,
  busy,
  error,
  actions,
}: {
  state: ClientState;
  now: () => number;
  busy: boolean;
  error: string | null;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const room = state.room;
  if (!room) return null;
  const data = room.phaseData;
  const you = room.you;
  const isLeader = (you?.isLeader ?? false) || (you?.canHost ?? false);
  const myId = you?.playerId ?? '';
  const lookAtTv = (testID: string, extra?: string) => (
    <Center testID={testID}>
      {extra ? <Title>{extra}</Title> : null}
      <Body tone="muted">{t('ctl.lookAtTv')}</Body>
    </Center>
  );
  const sitOut = (text?: string) => (
    <Center testID="ctl-sitout">
      {text ? <Title>{text}</Title> : null}
      <Body tone="muted">{t('ctl.statement.mine')}</Body>
    </Center>
  );

  switch (data.phase) {
    case 'WAITING':
    case 'LOBBY':
      return <LobbyView room={room} busy={busy} error={error} actions={actions} />;
    case 'COUNTDOWN':
      return lookAtTv('ctl-countdown', '🚀');
    case 'ROUND_INTRO':
      return lookAtTv(
        'ctl-intro',
        `${t('game.round.of', { n: data.round.index + 1, total: data.round.total })} · ${td(`game.kind.${data.round.kind}`)}`,
      );
    case 'FINAL':
      return lookAtTv('ctl-final', t('game.final.title'));
    case 'QUESTION_PREP': // retired phase (ADR-0022): a recovered room carries on as RISK_PICK
    case 'RISK_PICK':
      return you?.authorOfRound ? (
        sitOut()
      ) : (
        <RiskView
          key={data.round.index}
          room={room}
          data={{ ...data, phase: 'RISK_PICK' }}
          now={now}
          actions={actions}
        />
      );
    case 'SABOTAGE_PICK':
      return (
        <SabotageView key={data.round.index} room={room} data={data} now={now} actions={actions} />
      );
    case 'QUESTION':
      return (
        <Center testID="ctl-question">
          <Title>{data.text}</Title>
          <Body tone="muted">
            {you?.authorOfRound ? t('ctl.statement.mine') : t('game.question.getReady')}
          </Body>
        </Center>
      );
    case 'ANSWERING':
      return you?.authorOfRound ? (
        sitOut(data.text)
      ) : (
        <AnswerView data={data} state={state} now={now} actions={actions} />
      );
    case 'LOCKED':
      if (you?.authorOfRound) return sitOut();
      return (
        <Center testID="ctl-locked">
          <Title>{you?.answer ? t('ctl.answer.locked') : t('ctl.answer.late')}</Title>
          {you?.answer ? <Body tone="muted">{t('ctl.answer.waiting')}</Body> : null}
        </Center>
      );
    case 'REVEAL':
      return (
        <RevealView
          data={data}
          myId={myId}
          whoSaidIt={room.settings.mode === 'WHO_SAID_IT'}
          sitOut={you?.authorOfRound ?? false}
          actions={actions}
        />
      );
    case 'POWER_RESOLUTION':
      return lookAtTv('ctl-power');
    case 'SCORE_UPDATE':
      return <ScoreView data={data} myId={myId} room={room} />;
    case 'MICRO_INTERMISSION':
      return lookAtTv('ctl-next');
    case 'RESULTS':
      return (
        <ResultsView
          data={data}
          myId={myId}
          room={room}
          isLeader={isLeader}
          busy={busy}
          actions={actions}
        />
      );
    case 'ROOM_CLOSED':
      return (
        <Center testID="ctl-closed">
          <Text style={{ fontSize: 64 }}>⌛</Text>
          <Title>{t('ctl.closed')}</Title>
          <Button big label={t('ctl.rejoin')} onPress={actions.leave} />
        </Center>
      );
  }
}
