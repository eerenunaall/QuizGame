import { JoinContainer } from '../../src/containers/JoinContainer';
import { AppScreen } from '../../src/native/AppScreen';

export default function JoinEmpty() {
  return (
    <AppScreen>
      <JoinContainer code="" />
    </AppScreen>
  );
}
