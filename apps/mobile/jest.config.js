// pnpm keeps packages under node_modules/.pnpm/<name>@<ver>/node_modules/<name>, so the usual
// jest-expo `transformIgnorePatterns` need the `.pnpm` aware form below. Workspace packages ship
// TypeScript sources, so they are transformed too.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|expo-.*|react-navigation|@react-navigation|@quizparty))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
  moduleNameMapper: {},
};
