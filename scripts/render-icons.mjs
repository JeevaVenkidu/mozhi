import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const outputDirectory = new URL('../public/icons/', import.meta.url);
const scale = 4;
const teal = [15, 118, 110, 255];
const white = [255, 255, 255, 255];
const mainSparkle = [[12, 2], [13.4, 7.6], [19, 9], [13.4, 10.4], [12, 16], [10.6, 10.4], [5, 9], [10.6, 7.6]];
const smallSparkle = [[19, 15], [19.7, 17.3], [22, 18], [19.7, 18.7], [19, 21], [18.3, 18.7], [16, 18], [18.3, 17.3]];

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pixelColor(x, y) {
  const radius = 5.2;
  const cornerX = Math.max(radius, Math.min(24 - radius, x));
  const cornerY = Math.max(radius, Math.min(24 - radius, y));
  if ((x - cornerX) ** 2 + (y - cornerY) ** 2 > radius ** 2) return [0, 0, 0, 0];
  if (insidePolygon(x, y, mainSparkle) || insidePolygon(x, y, smallSparkle)) return white;
  return teal;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function renderPng(size) {
  const rawSize = size * scale;
  const highResolution = Buffer.alloc(rawSize * rawSize * 4);
  for (let y = 0; y < rawSize; y += 1) {
    for (let x = 0; x < rawSize; x += 1) {
      const color = pixelColor((x + 0.5) / rawSize * 24, (y + 0.5) / rawSize * 24);
      highResolution.set(color, (y * rawSize + x) * 4);
    }
  }

  const scanlines = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const sourceOffset = ((y * scale + sy) * rawSize + x * scale + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += highResolution[sourceOffset + channel];
        }
      }
      const targetOffset = rowOffset + 1 + x * 4;
      for (let channel = 0; channel < 4; channel += 1) scanlines[targetOffset + channel] = Math.round(sums[channel] / (scale * scale));
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

await mkdir(outputDirectory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(new URL(`icon-${size}.png`, outputDirectory), renderPng(size));
}
