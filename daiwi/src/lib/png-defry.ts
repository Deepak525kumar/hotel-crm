import zlib from "node:zlib";

/**
 * Xcode runs app icons through `pngcrush -iphone`, producing a non-standard PNG:
 *   - an extra `CgBI` chunk before IHDR
 *   - IDAT holds RAW deflate data (no zlib header/checksum)
 *   - pixels are BGRA with premultiplied alpha, not RGBA
 *
 * Browsers refuse these. This reverses the mangling and returns a normal PNG.
 * Port of the pngdefry algorithm.
 */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Chunk {
  type: string;
  data: Buffer;
}

function readChunks(buf: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let off = 8; // skip signature
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const start = off + 8;
    const end = start + len;
    if (end + 4 > buf.length) break;
    chunks.push({ type, data: buf.subarray(start, end) });
    off = end + 4; // skip CRC
    if (type === "IEND") break;
  }
  return chunks;
}

// CRC32 with the PNG polynomial.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverse PNG scanline filtering in place, returning raw pixel rows. */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos + x];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= bpp && y > 0 ? out[prevStart + x - bpp] : 0;

      let val: number;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error(`unknown PNG filter type ${filter}`);
      }
      out[rowStart + x] = val & 0xff;
    }
    pos += stride;
  }
  return out;
}

/** Re-apply filter type 0 (None) to every scanline. */
function refilter(pixels: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 0;
    pixels.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return out;
}

export function isCgBI(buf: Buffer): boolean {
  if (buf.length < 16 || !buf.subarray(0, 8).equals(PNG_SIG)) return false;
  return buf.toString("ascii", 12, 16) === "CgBI";
}

/**
 * Returns a browser-renderable PNG. Non-CgBI input is returned untouched.
 * Throws if the image uses a format the reverser does not handle.
 */
export function defryPng(input: Buffer): Buffer {
  if (!isCgBI(input)) return input;

  const chunks = readChunks(input);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("CgBI PNG has no IHDR");

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`unsupported CgBI PNG: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  if (interlace !== 0) throw new Error("interlaced CgBI PNG not supported");

  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  // CgBI strips the zlib wrapper, so this is a raw deflate stream.
  const raw = zlib.inflateRawSync(idat);

  const bpp = 4;
  const expected = (width * bpp + 1) * height;
  if (raw.length < expected) {
    throw new Error(`CgBI IDAT too short: got ${raw.length}, expected ${expected}`);
  }

  const pixels = unfilter(raw, width, height, bpp);

  // BGRA premultiplied -> RGBA straight.
  for (let i = 0; i < pixels.length; i += 4) {
    const b = pixels[i];
    const g = pixels[i + 1];
    const r = pixels[i + 2];
    const a = pixels[i + 3];
    if (a === 0) {
      pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0;
    } else if (a === 255) {
      pixels[i] = r; pixels[i + 2] = b;
    } else {
      pixels[i] = Math.min(255, Math.round((r * 255) / a));
      pixels[i + 1] = Math.min(255, Math.round((g * 255) / a));
      pixels[i + 2] = Math.min(255, Math.round((b * 255) / a));
    }
  }

  const recompressed = zlib.deflateSync(refilter(pixels, width, height, bpp), { level: 9 });

  // Rebuild without CgBI, and drop iDOT (another Apple-only chunk).
  const parts: Buffer[] = [PNG_SIG, writeChunk("IHDR", ihdr.data)];
  for (const c of chunks) {
    if (["IHDR", "IDAT", "IEND", "CgBI", "iDOT"].includes(c.type)) continue;
    parts.push(writeChunk(c.type, c.data));
  }
  parts.push(writeChunk("IDAT", recompressed));
  parts.push(writeChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(parts);
}
