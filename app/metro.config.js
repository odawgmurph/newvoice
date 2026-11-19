const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Drizzle's generated migrations (drizzle/*.sql) are bundled as source.
config.resolver.sourceExts.push('sql');

module.exports = config;
