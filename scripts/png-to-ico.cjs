const fs = require('node:fs');

const [, , outputPath, ...inputPaths] = process.argv;
if (!outputPath || !inputPaths.length) {
  console.error('Usage: node scripts/png-to-ico.cjs output.ico input-16.png input-32.png ...');
  process.exit(1);
}

const images = inputPaths.map(inputPath => {
  const png = fs.readFileSync(inputPath);
  return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
});
const directorySize = 6 + images.length * 16;
const header = Buffer.alloc(directorySize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let dataOffset = directorySize;
images.forEach(({ png, width, height }, index) => {
  const offset = 6 + index * 16;
  header.writeUInt8(width >= 256 ? 0 : width, offset);
  header.writeUInt8(height >= 256 ? 0 : height, offset + 1);
  header.writeUInt8(0, offset + 2);
  header.writeUInt8(0, offset + 3);
  header.writeUInt16LE(1, offset + 4);
  header.writeUInt16LE(32, offset + 6);
  header.writeUInt32LE(png.length, offset + 8);
  header.writeUInt32LE(dataOffset, offset + 12);
  dataOffset += png.length;
});
fs.writeFileSync(outputPath, Buffer.concat([header, ...images.map(image => image.png)]));
