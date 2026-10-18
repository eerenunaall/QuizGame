import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PhaseDataOf } from '@quizparty/protocol';
import {
  fiftyFiftyState,
  isFogged,
  isRemoved,
  orderedOptions,
  personalDeadline,
  type ClientState,
} from '@quizparty/controller-client';
import { ANSWER_LETTERS } from '@quizparty/ui-tokens';
import { Body, Button, Center, ErrorText, Panel, TimerBar, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { TARGET, theme } from '../ui/theme';
import type { ControllerActions } from './actions';

/** Letter + shape + colour: nothing is conveyed by colour alone (ADR-0017). */
const SHAPES = ['▲', '◆', '●', '■', '★', '⬟', '✚', '⬢'] as const;

/** True while FOG still hides an option; re-evaluated on a short tick so the veil lifts on its own. */
function useFogActive(openedAt: number, fogMs: number, now: () => number): boolean {
  const [, tick] = useState(0);
  const active = fogMs > 0 && now() < openedAt + fogMs;
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 150);
    return () => clearInterval(id);
  }, [active]);
  return active;
}

export function AnswerView({
  data,
  state,
  now,
  actions,
}: {
  data: PhaseDataOf<'ANSWERING'>;
  state: ClientState;
  now: () => number;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const you = state.room?.you ?? null;
  const answer = you?.answer ?? null;
  const pending = state.pendingAnswer;
  const rejection = state.answerRejection;
  const locked = answer !== null && answer.questionId === data.questionId;
  const effects = you?.effects ?? null;
  const keep = you?.fiftyFifty?.keep;
  const options = orderedOptions(data.options, effects?.order);
  const fogActive = useFogActive(data.answerOpensAt, effects?.fogMs ?? 0, now);
  const fiftyBlock = fiftyFiftyState(you);

  useEffect(() => {
    if (locked) actions.haptic?.('lock');
    // The haptic callback identity is irrelevant to when a lock happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (locked) {
    return (
      <Center testID="ctl-confirmed">
        <Text style={styles.bigIcon}>✓</Text>
        <Title>{t('ctl.answer.locked')}</Title>
        <Body tone="muted">{t('ctl.answer.waiting')}</Body>
      </Center>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="ctl-answering">
      <Panel>
        <Text style={styles.question} accessibilityRole="header">
          {data.text}
        </Text>
      </Panel>
      <View style={styles.options}>
        {options.map((option, index) => {
          const chosen = pending?.optionId === option.optionId;
          const removed = isRemoved(option.optionId, keep);
          const veiled = fogActive && isFogged(option.optionId, effects, data.answerOpensAt, now());
          const letter = ANSWER_LETTERS[index] ?? String(index + 1);
          const disabled = pending !== null || removed;
          return (
            <Pressable
              key={option.optionId}
              testID={`option-${option.optionId}`}
              accessibilityRole="button"
              accessibilityLabel={t('m.question.a11y', {
                letter,
                text: veiled ? '…' : option.text,
              })}
              accessibilityState={{ disabled, selected: chosen }}
              disabled={disabled}
              onPress={() => {
                actions.haptic?.('tap');
                actions.answer(option.optionId);
              }}
              style={[
                styles.option,
                { backgroundColor: theme.answerColors[index % theme.answerColors.length] },
                (removed || (pending !== null && !chosen)) && styles.dim,
                chosen && styles.chosen,
              ]}
            >
              <Text style={styles.badge}>
                {letter} {SHAPES[index % SHAPES.length]}
              </Text>
              <Text style={styles.optionText}>{veiled ? '• • •' : option.text}</Text>
            </Pressable>
          );
        })}
      </View>
      {rejection ? <ErrorText>{td(`error.${rejection.code}`)}</ErrorText> : null}
      {keep ? (
        <Body tone="muted" testID="fifty-used">
          {t('ctl.fifty.used')}
        </Body>
      ) : fiftyBlock === null && !pending ? (
        <Button
          testID="use-fifty"
          variant="violet"
          label={`${t('ctl.fifty.use')} · ${t('ctl.fifty.left', { count: you?.powers?.fiftyFifty ?? 0 })}`}
          onPress={actions.fifty}
        />
      ) : fiftyBlock === 'LOCKED' ? (
        <Body tone="muted">{t('ctl.fifty.locked')}</Body>
      ) : null}
      <TimerBar
        now={now}
        startAt={data.answerOpensAt}
        deadlineAt={personalDeadline(data.answerDeadlineAt, effects)}
        testID="answer-timer"
      />
      <Text accessibilityLiveRegion="polite" style={styles.sr}>
        {pending ? t('ctl.answer.sending') : t('ctl.answer.pick')}
      </Text>
    </ScrollView>
  );
}

const { spacing, radius, colors } = theme;
const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
  question: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  options: { gap: spacing.sm },
  option: {
    minHeight: TARGET.big,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  badge: { color: colors.backgroundDeep, fontSize: 22, fontWeight: '900', minWidth: 52 },
  optionText: { color: colors.backgroundDeep, fontSize: 19, fontWeight: '800', flex: 1 },
  dim: { opacity: 0.35 },
  chosen: { borderWidth: 4, borderColor: colors.text },
  bigIcon: { color: colors.success, fontSize: 96, fontWeight: '900' },
  sr: { height: 1, opacity: 0 },
});
