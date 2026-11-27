// Adds NewVoice's discreet alternate icons to the iOS app (Stage 4,
// decision D23). Each icon becomes its own app icon set in the asset
// catalog, and the build is told to include them as alternates, so
// UIApplication.setAlternateIconName (modules/newvoice-discreet) can use them.
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const ICONS = [
  { name: 'AppIconDots', file: 'assets/alt-icons/dots.png' },
  { name: 'AppIconWaves', file: 'assets/alt-icons/waves.png' },
];

function withIconSets(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const catalog = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName, 'Images.xcassets');
      for (const icon of ICONS) {
        const dir = path.join(catalog, `${icon.name}.appiconset`);
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(path.join(cfg.modRequest.projectRoot, icon.file), path.join(dir, 'icon.png'));
        fs.writeFileSync(
          path.join(dir, 'Contents.json'),
          JSON.stringify(
            {
              images: [{ filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
              info: { author: 'newvoice', version: 1 },
            },
            null,
            2,
          ),
        );
      }
      return cfg;
    },
  ]);
}

function withBuildSettings(config) {
  return withXcodeProject(config, (cfg) => {
    const configs = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configs)) {
      const settings = configs[key].buildSettings;
      // Only the app target's configurations carry an Info.plist.
      if (!settings || !settings.INFOPLIST_FILE) continue;
      settings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = `"${ICONS.map((i) => i.name).join(' ')}"`;
      settings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = 'YES';
    }
    return cfg;
  });
}

module.exports = function withAlternateIcons(config) {
  return withBuildSettings(withIconSets(config));
};
