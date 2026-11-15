-- ADR-0023: Stake Cap, Cut and Blind Clock join the sabotage audit trail.
ALTER TABLE sabotage_events DROP CONSTRAINT sabotage_events_effect_check;
ALTER TABLE sabotage_events
  ADD CONSTRAINT sabotage_events_effect_check CHECK (
    effect IN ('JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX', 'STAKE_CAP', 'CUT', 'BLIND_CLOCK')
  );
