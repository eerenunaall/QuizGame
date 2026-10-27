import { useRouter } from 'expo-router';
import { InvalidLinkScreen } from '../screens/LinkScreens';

export function InvalidLink() {
  const router = useRouter();
  return <InvalidLinkScreen onHome={() => router.replace('/')} />;
}
