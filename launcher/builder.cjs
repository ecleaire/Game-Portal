module.exports = {
  appId: 'jp.gameportal.offline', productName: 'GAME PORTAL',
  compression: 'normal',
  directories: { output: 'launcher-release' },
  files: ['launcher/**/*', 'assets/private-preview.js', 'package.json'],
  extraMetadata: { main: 'launcher/main.cjs', version: '0.1.0' },
  win: { target: [{ target: 'portable', arch: ['x64'] }], artifactName: 'GAME-PORTAL-${version}-Windows-${arch}.${ext}', signAndEditExecutable: false },
};
