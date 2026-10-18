import { Redirect, useLocalSearchParams } from 'expo-router';
import { validRoomCode } from '../../src/core/links';
import { InvalidLink } from '../../src/native/InvalidLink';
import { AppScreen } from '../../src/native/AppScreen';

/** The short universal-link path `https://<host>/j/CODE` forwards to the join screen. */
export default function ShortJoin() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const valid = validRoomCode(code);
  if (valid) return <Redirect href={`/join/${valid}`} />;
  return (
    <AppScreen>
      <InvalidLink />
    </AppScreen>
  );
}
