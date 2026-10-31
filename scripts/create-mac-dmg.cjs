const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const appPath = path.join(root, 'out', 'Francis Player-darwin-universal', 'Francis Player.app');
const stagingPath = path.join(root, 'out', 'dmg-staging');
const outputDirectory = path.join(root, 'out', 'make', 'dmg', 'universal');
const outputPath = path.join(outputDirectory, `Francis-Player-${version}-macOS-universal.dmg`);

if (!fs.existsSync(appPath)) throw new Error(`Universal application not found: ${appPath}`);
fs.rmSync(stagingPath, { recursive: true, force: true });
fs.mkdirSync(stagingPath, { recursive: true });
fs.cpSync(appPath, path.join(stagingPath, 'Francis Player.app'), { recursive: true });
fs.symlinkSync('/Applications', path.join(stagingPath, 'Applications'));
fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(outputPath, { force: true });

const result = spawnSync('hdiutil', [
  'create', '-volname', 'Francis Player', '-srcfolder', stagingPath,
  '-ov', '-format', 'UDZO', outputPath
], { stdio: 'inherit' });
fs.rmSync(stagingPath, { recursive: true, force: true });
if (result.status !== 0) throw new Error(`hdiutil exited with code ${result.status}`);
console.log(outputPath);
