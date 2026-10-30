// Generates build/icon.png (512px) and build/icon.ico (256px PNG-in-ICO) with no image dependencies.
// The design matches src/components/Logo.tsx: dark rounded square, white ring, red record dot.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));

/** Colour (premultiplied-free RGBA 0..1) at normalized coords u,v in [0,1]. */
function sample(u, v) {
  // Rounded square 2/64 .. 62/64 with radius 16/64.
  const m = 2 / 64, r = 16 / 64;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0);
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];

  let color = mix([0x3a / 255, 0x3f / 255, 0x4b / 255], [0x14 / 255, 0x16 / 255, 0x1b / 255], (u + v) / 2);
  const d = Math.hypot(u - 0.5, v - 0.5);
  const ring = 18 / 64, ringW = 2 / 64, dot = 10.5 / 64;
  if (Math.abs(d - ring) <= ringW) color = [1, 1, 1];
  if (d <= dot) {
    const g = Math.min(1, Math.hypot(u - 0.46, v - 0.45) / (dot * 1.4));
    color = mix([1, 0x6b / 255, 0x6b / 255], [0xd6 / 255, 0x1f / 255, 0x2c / 255], g);
  }
  return [...color, 1];
}

function render(size, ss = 4) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (y * size + x) * 4;
      const n = ss * ss;
      out[i] = a ? Math.round((r / a) * 255) : 0;
      out[i + 1] = a ? Math.round((g / a) * 255) : 0;
      out[i + 2] = a ? Math.round((b / a) * 255) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.png'), encodePng(512, render(512)));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(join(outDir, 'icon.ico'), encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) }))));
console.log('Wrote build/icon.png and build/icon.ico');
