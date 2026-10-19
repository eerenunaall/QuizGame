import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useApp, useStore } from '../native/AppProviders';
import type { ControllerActions } from '../screens/actions';
import { ControllerScreen } from '../screens/ControllerScreen';
import { describeFailure } from '../screens/errors';
import { ReconnectBanner, bannerKind } from '../screens/ReconnectBanner';
import { Body, Button, Center } from '../ui/components';
import { useI18n } from '../ui/i18n';

/** The phone in a room: resume the stored seat, then render the controller for the server's phase. */
export function RoomContainer({ code }: { code: string }) {
  const { runtime, haptic } = useApp();
  const { client } = runtime;
  const i18n = useI18n();
  const router = useRouter();
  const state = useStore(client.store);
  const now = useMemo(() => (): number => client.serverNow(), [client]);
  const [resuming, setResuming] = useState(true);
  const [noSeat, setNoSeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRestored, setShowRestored] = useState(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const inThisRoom = client.state.session?.code === code && client.state.room !== null;
      const resumed = inThisRoom || (await client.resume('PLAYER', code).catch(() => false));
      if (cancelled) return;
      setNoSeat(!resumed);
      setResuming(false);
    })();
    return () => {
      cancelled = true;
      // Leaving the screen must not keep a socket open (the seat stays stored for resume).
      client.suspend();
    };
  }, [client, code]);

  useEffect(() => {
    if (state.restoredAt === null) return undefined;
    setShowRestored(true);
    const id = setTimeout(() => setShowRestored(false), 3000);
    return () => clearTimeout(id);
  }, [state.restoredAt]);

  const flash = useCallback(
    (cause: unknown): void => {
      setError(describeFailure(i18n, cause));
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setError(null), 4000);
    },
    [i18n],
  );
  const guard = (run: () => Promise<void>) => (): void => {
    setBusy(true);
    run()
      .catch(flash)
      .finally(() => setBusy(false));
  };

  const actions: ControllerActions = {
    ready: (ready) => void client.setReady(ready).catch(flash),
    start: guard(() => client.startGame()),
    settings: (change) => void client.setSettings(change).catch(flash),
    answer: (optionId) => void client.submitAnswer(optionId).catch(() => undefined),
    rematch: guard(() => client.rematch()),
    backToLobby: guard(() => client.backToLobby()),
    leave: () => {
      void client
        .leave()
        .then(() => client.forget())
        .then(() => router.replace('/'));
    },
    commitRisk: (choice) => client.commitRisk(choice),
    commitSabotage: (choice) => client.commitSabotage(choice),
    fifty: () => void client.useFiftyFifty().catch(flash),
    submitStatement: (text) => client.submitStatement(text),
    haptic,
  };

  if (resuming) {
    return (
      <Center testID="room-loading">
        <Body tone="muted">{i18n.t('common.loading')}</Body>
      </Center>
    );
  }
  if (state.closedReason && state.closedReason !== 'LEFT') {
    const message =
      state.closedReason === 'KICKED'
        ? i18n.t('ctl.kicked')
        : state.closedReason === 'SUPERSEDED'
          ? i18n.t('ctl.superseded')
          : state.closedReason === 'ROOM_CLOSED'
            ? i18n.t('ctl.closed')
            : i18n.t('ctl.revoked');
    return (
      <Center testID="ctl-ended">
        <Body>{message}</Body>
        <Button
          big
          label={i18n.t('ctl.rejoin')}
          onPress={() => void client.forget().then(() => router.replace(`/join/${code}`))}
        />
      </Center>
    );
  }
  if (noSeat || !state.room || state.session?.code !== code) {
    return noSeat ? <Redirect href={`/join/${code}`} /> : null;
  }
  return (
    <View style={{ flex: 1 }}>
      <ReconnectBanner kind={bannerKind(state, showRestored)} />
      <ControllerScreen state={state} now={now} busy={busy} error={error} actions={actions} />
    </View>
  );
}
