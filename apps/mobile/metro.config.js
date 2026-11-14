// Expo's default config already understands pnpm workspaces (symlinked packages are watched).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
