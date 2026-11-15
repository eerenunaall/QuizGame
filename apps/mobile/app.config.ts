import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Build-time configuration (ADR-0017). Everything environment specific comes from env variables so
 * the same source builds the development, preview and production variants (see eas.json). No
 * secret ever goes in here: the app holds only public identifiers; verification keys live on the
 * server (ADR-0013).
 *
 * OWNER-TO-FILL: the bundle id / package name below are placeholders. Replace them (or set
 * QP_BUNDLE_ID / QP_ANDROID_PACKAGE) with identifiers registered in your Apple and Google accounts
 * BEFORE the first store build; they cannot be changed afterwards. Checklist: docs/MOBILE.md.
 */
export const PLACEHOLDER_IDENTIFIER = 'com.example.quiznight';

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = (env('QP_API_URL') ?? 'http://localhost:8080').replace(/\/+$/, '');
  const webUrl = (env('QP_WEB_URL') ?? env('QP_API_URL') ?? 'http://localhost:5173').replace(
    /\/+$/,
    '',
  );
  const wsUrl = env('QP_WS_URL') ?? `${apiUrl.replace(/^http/, 'ws')}/ws`;
  const webHost = new URL(webUrl).host;
  const ios = env('QP_BUNDLE_ID') ?? PLACEHOLDER_IDENTIFIER;
  const android = env('QP_ANDROID_PACKAGE') ?? PLACEHOLDER_IDENTIFIER;
  const release = env('EAS_BUILD_PROFILE') === 'production';
  if (release && (!apiUrl.startsWith('https://') || !wsUrl.startsWith('wss://')))
    throw new Error('Production builds need https:// and wss:// server URLs (QP_API_URL).');
  if (release && (ios === PLACEHOLDER_IDENTIFIER || android === PLACEHOLDER_IDENTIFIER))
    throw new Error(
      'OWNER-TO-FILL: set QP_BUNDLE_ID and QP_ANDROID_PACKAGE for production builds.',
    );

  // Universal / app links only make sense on a real https host (Android autoVerify needs https).
  const httpsHost = webUrl.startsWith('https://');

  return {
    ...config,
    name: 'QuizNight',
    slug: 'quiznight',
    scheme: 'quiznight',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    icon: './assets/icon.png',
    ios: {
      bundleIdentifier: ios,
      supportsTablet: false,
      ...(httpsHost ? { associatedDomains: [`applinks:${webHost}`] } : {}),
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },
    android: {
      package: android,
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#060d2e' },
      ...(httpsHost
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [
                  { scheme: 'https', host: webHost, pathPrefix: '/j' },
                  { scheme: 'https', host: webHost, pathPrefix: '/join' },
                  { scheme: 'https', host: webHost, pathPrefix: '/unlock' },
                ],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : {}),
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-localization',
      'expo-iap',
      ['expo-splash-screen', { image: './assets/splash-icon.png', backgroundColor: '#060d2e' }],
    ],
    experiments: { typedRoutes: false },
    extra: {
      apiUrl,
      wsUrl,
      webUrl,
      productId: env('QP_PRODUCT_ID') ?? 'quizparty_full_game',
    },
  };
};
