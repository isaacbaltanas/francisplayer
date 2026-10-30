module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/ffmpeg-static/**' },
    name: 'Francis Player',
    executableName: 'francis-player',
    extendInfo: {
      CFBundleDocumentTypes: [{
        CFBundleTypeName: 'Francis Player Project',
        CFBundleTypeExtensions: ['francis'],
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
