import { useLocalSearchParams } from 'expo-router';
import { validRoomCode } from '../../src/core/links';
import { JoinContainer } from '../../src/containers/JoinContainer';
import { InvalidLink } from '../../src/native/InvalidLink';
import { AppScreen } from '../../src/native/AppScreen';

/** `quiznight://join/CODE` and `https://<host>/join/CODE`. The parameter is validated again here. */
export default function JoinWithCode() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const valid = validRoomCode(code);
  return <AppScreen>{valid ? <JoinContainer code={valid} /> : <InvalidLink />}</AppScreen>;
}
