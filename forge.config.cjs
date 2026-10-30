const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/ffmpeg-static/**' },
    name: 'Francis Player',
    executableName: 'Francis Player',
    icon: path.resolve(__dirname, 'assets', 'icon'),
    appBundleId: 'com.francisplayer.app',
    appCategoryType: 'public.app-category.music',
    win32metadata: {
      CompanyName: 'Francis Player',
      FileDescription: 'Estudio de montaje automático para megafonías',
      InternalName: 'Francis Player',
      OriginalFilename: 'Francis Player.exe',
      ProductName: 'Francis Player'
    },
    extendInfo: {
      CFBundleDisplayName: 'Francis Player',
      CFBundleDocumentTypes: [{
        CFBundleTypeName: 'Francis Player Project',
        CFBundleTypeExtensions: ['francis'],
        CFBundleTypeIconFile: 'electron.icns',
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner'
      }]
    },
    ignore: [
      /^\/src($|\/)/,
      /^\/electron($|\/)/,
      /^\/tests($|\/)/,
      /^\/\.git($|\/)/
    ]
  }
};
