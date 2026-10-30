module.exports = {
  packagerConfig: {
    asar: true,
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
