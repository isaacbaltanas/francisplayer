module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Francis Player',
    executableName: 'francis-player',
    ignore: [
      /^\/src($|\/)/,
      /^\/electron($|\/)/,
      /^\/tests($|\/)/,
      /^\/\.git($|\/)/
    ]
  }
};
