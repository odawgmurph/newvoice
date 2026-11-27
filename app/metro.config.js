const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Drizzle's generated migrations (drizzle/*.sql) are bundled as source.
config.resolver.sourceExts.push('sql');
// The curriculum lives in ../content (bundled, OTA-updatable, kept apart from code).
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../content')];

module.exports = config;
