import { useLocalSearchParams } from 'expo-router';
import { validRoomCode } from '../../src/core/links';
import { RoomContainer } from '../../src/containers/RoomContainer';
import { InvalidLink } from '../../src/native/InvalidLink';
import { AppScreen } from '../../src/native/AppScreen';

export default function Room() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const valid = validRoomCode(code);
  return <AppScreen>{valid ? <RoomContainer code={valid} /> : <InvalidLink />}</AppScreen>;
}
