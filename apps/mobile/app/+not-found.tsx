import { InvalidLink } from '../src/native/InvalidLink';
import { AppScreen } from '../src/native/AppScreen';

/** Anything that matches no route (a malformed link included) lands on the safe "link not valid" screen. */
export default function NotFound() {
  return (
    <AppScreen>
      <InvalidLink />
    </AppScreen>
  );
}
