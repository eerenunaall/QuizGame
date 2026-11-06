// Component tests render screens with injected props; native modules are not exercised here
// (haptics, secure store, store billing are device-only, see docs/MOBILE.md).
import { beforeAll } from '@jest/globals';
import { cleanup, render } from '@testing-library/react-native';
import { createElement } from 'react';
import * as rn from 'react-native';

// The first render in each test file pays a one-off cost (React Native's host components, the test
// renderer and the icon/animation modules load lazily on first use): ~6 s on a cold runner, which
// landed inside whichever test happened to run first and blew its 5 s budget. Pay it here, once per
// file, in its own hook, so every test measures only its own work.
beforeAll(async () => {
  await render(
    createElement(
      rn.View,
      null,
      createElement(rn.Text, null, 'warm'),
      createElement(rn.TextInput),
      createElement(rn.Pressable),
      createElement(rn.ScrollView),
      createElement(rn.Switch),
    ),
  );
  await cleanup();
}, 60_000);
