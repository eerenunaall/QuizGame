import { useLocalSearchParams } from 'expo-router';
import { validIntentId } from '../../src/core/links';
import { UnlockContainer } from '../../src/containers/UnlockContainer';
import { InvalidLink } from '../../src/native/InvalidLink';
import { AppScreen } from '../../src/native/AppScreen';

export default function Unlock() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const valid = validIntentId(id);
  return <AppScreen>{valid ? <UnlockContainer intentId={valid} /> : <InvalidLink />}</AppScreen>;
}
