import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'public', 'miaw-logo.png');
const outputPath = path.join(projectRoot, 'icons', 'miaw.ico');

function readUInt32BE(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function parsePngChunks(buffer) {
  const signature = buffer.subarray(0, 8);
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(expected)) {
    throw new Error('Source file is not a valid PNG');
  }

  let offset = 8;
  const chunks = [];

  while (offset < buffer.length) {
    const length = readUInt32BE(buffer, offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    chunks.push({ type, data });
    offset = dataEnd + 4;
    if (type === 'IEND') {
      break;
    }
  }

  return chunks;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(buffer) {
  const chunks = parsePngChunks(buffer);
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr) {
    throw new Error('PNG is missing IHDR');
  }

  const width = readUInt32BE(ihdr.data, 0);
  const height = readUInt32BE(ihdr.data, 4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error('Only 8-bit RGBA PNG files are supported');
  }
  if (interlace !== 0) {
    throw new Error('Interlaced PNG files are not supported');
  }

  const compressed = Buffer.concat(
    chunks
      .filter((chunk) => chunk.type === 'IDAT')
      .map((chunk) => chunk.data)
  );
  const inflated = zlib.inflateSync(compressed);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const rgba = Buffer.alloc(width * height * bytesPerPixel);

  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[srcOffset];
    srcOffset += 1;

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[srcOffset++];
      const left = x >= bytesPerPixel ? rgba[dstOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? rgba[dstOffset + x - stride] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel
          ? rgba[dstOffset + x - stride - bytesPerPixel]
          : 0;

      let value = raw;
      switch (filterType) {
        case 0:
          break;
        case 1:
          value = (raw + left) & 0xff;
          break;
        case 2:
          value = (raw + up) & 0xff;
          break;
        case 3:
          value = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          value = (raw + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter type: ${filterType}`);
      }

      rgba[dstOffset + x] = value;
    }

    dstOffset += stride;
  }

  return { width, height, rgba };
}

function findOpaqueBounds(width, height, rgba, alphaThreshold = 10) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha <= alphaThreshold) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX === -1 || maxY === -1) {
    return { x: 0, y: 0, width, height };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function cropToSquare(width, height, rgba) {
  const bounds = findOpaqueBounds(width, height, rgba);
  const size = Math.max(bounds.width, bounds.height);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  let cropX = Math.round(centerX - size / 2);
  let cropY = Math.round(centerY - size / 2);

  cropX = Math.max(0, Math.min(cropX, width - size));
  cropY = Math.max(0, Math.min(cropY, height - size));

  const square = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const srcX = cropX + x;
      const srcY = cropY + y;
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * size + x) * 4;
      rgba.copy(square, dstIdx, srcIdx, srcIdx + 4);
    }
  }

  return { size, rgba: square };
}

function resizeNearest(srcSize, srcRgba, targetSize) {
  const out = Buffer.alloc(targetSize * targetSize * 4);

  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const srcX = Math.min(srcSize - 1, Math.floor((x * srcSize) / targetSize));
      const srcY = Math.min(srcSize - 1, Math.floor((y * srcSize) / targetSize));
      const srcIdx = (srcY * srcSize + srcX) * 4;
      const dstIdx = (y * targetSize + x) * 4;
      srcRgba.copy(out, dstIdx, srcIdx, srcIdx + 4);
    }
  }

  return out;
}

function createBmpIconImage(size, rgba) {
  const rowStride = size * 4;
  const xorBitmap = Buffer.alloc(rowStride * size);
  const andRowStride = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(andRowStride * size, 0);

  for (let y = 0; y < size; y += 1) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const srcIdx = (srcY * size + x) * 4;
      const dstIdx = (y * size + x) * 4;
      xorBitmap[dstIdx] = rgba[srcIdx + 2];
      xorBitmap[dstIdx + 1] = rgba[srcIdx + 1];
      xorBitmap[dstIdx + 2] = rgba[srcIdx];
      xorBitmap[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xorBitmap.length + andMask.length, 20);
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  return Buffer.concat([header, xorBitmap, andMask]);
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const dirOffset = index * 16;
    directory[dirOffset] = entry.size >= 256 ? 0 : entry.size;
    directory[dirOffset + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[dirOffset + 2] = 0;
    directory[dirOffset + 3] = 0;
    directory.writeUInt16LE(1, dirOffset + 4);
    directory.writeUInt16LE(32, dirOffset + 6);
    directory.writeUInt32LE(entry.data.length, dirOffset + 8);
    directory.writeUInt32LE(offset, dirOffset + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

async function main() {
  const pngBuffer = await fs.readFile(sourcePath);
  const decoded = decodePngRgba(pngBuffer);
  const square = cropToSquare(decoded.width, decoded.height, decoded.rgba);
  const sizes = [16, 24, 32, 48, 64, 128, 256];

  const entries = sizes.map((size) => ({
    size,
    data: createBmpIconImage(size, resizeNearest(square.size, square.rgba, size))
  }));

  await fs.writeFile(outputPath, buildIco(entries));
  console.log(`Generated ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
