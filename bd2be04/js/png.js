// Writing the kind of PNG this repository already holds.
//
// All 574 assets in v1.10 are palette PNGs — colour type 3, and 29 of them at 4
// bits per pixel — because they go through ImageOptim before they are handed
// over. A canvas writes RGBA instead, and the same picture comes out around
// eight times bigger: 978 KB where the shipped file is 119 KB. Uploading
// through the reader would then quietly make the repository grow by an order of
// magnitude per drawing.
//
// So the reader quantises and encodes the PNG itself: median cut to at most 256
// colours, the narrowest bit depth that holds them, deflate through
// CompressionStream. No dependency, and nothing to build. If anything here is
// unavailable the caller falls back to the canvas, which is correct, only fat.

const MAX_COLOURS = 256;

// ---------------------------------------------------------------- quantising

const key = (r, g, b, a) => (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
const parts = (k) => [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];

function histogram(data) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const k = key(data[i], data[i + 1], data[i + 2], data[i + 3]);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function box(colours) {
  let count = 0;
  const lo = [255, 255, 255, 255];
  const hi = [0, 0, 0, 0];
  for (const colour of colours) {
    count += colour.count;
    for (let c = 0; c < 4; c++) {
      if (colour.v[c] < lo[c]) lo[c] = colour.v[c];
      if (colour.v[c] > hi[c]) hi[c] = colour.v[c];
    }
  }
  let channel = 0;
  let widest = -1;
  for (let c = 0; c < 4; c++) {
    if (hi[c] - lo[c] > widest) {
      widest = hi[c] - lo[c];
      channel = c;
    }
  }
  return { colours, count, channel, widest };
}

/** Median cut: split the box that spans the most colour, weighted by how much
 *  of the picture is in it, until there are enough boxes for a palette. */
function medianCut(counts, max) {
  const colours = [...counts].map(([k, count]) => ({ v: parts(k), count }));
  let boxes = [box(colours)];

  while (boxes.length < max) {
    let pick = -1;
    let score = 0;
    for (let i = 0; i < boxes.length; i++) {
      const value = boxes[i].widest * boxes[i].count;
      if (boxes[i].colours.length > 1 && value > score) {
        score = value;
        pick = i;
      }
    }
    if (pick === -1) break;

    // Cut where half the pixels lie, not half the colours: a box is split by
    // how much of the picture is on each side of the line.
    const { colours: list, channel, count } = boxes[pick];
    list.sort((a, b) => a.v[channel] - b.v[channel]);
    let running = 0;
    let at = 0;
    while (at < list.length - 1 && running * 2 < count) running += list[at++].count;
    boxes.splice(pick, 1, box(list.slice(0, at)), box(list.slice(at)));
  }

  return boxes.map(({ colours: list, count }) => {
    const sum = [0, 0, 0, 0];
    for (const colour of list) {
      for (let c = 0; c < 4; c++) sum[c] += colour.v[c] * colour.count;
    }
    return sum.map((total) => Math.round(total / count));
  });
}

/** Palette index per pixel. Exact colours are cached, so the search runs once
 *  per distinct colour rather than once per pixel. */
function indexPixels(data, palette) {
  const cache = new Map();
  const out = new Uint8Array(data.length / 4);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const k = key(data[i], data[i + 1], data[i + 2], data[i + 3]);
    let index = cache.get(k);
    if (index === undefined) {
      let best = 0;
      let distance = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const [r, g, b, a] = palette[c];
        const d =
          (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2 + (data[i + 3] - a) ** 2;
        if (d < distance) {
          distance = d;
          best = c;
        }
      }
      index = best;
      cache.set(k, index);
    }
    out[p] = index;
  }
  return out;
}

// ------------------------------------------------------------------ encoding

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Rows of palette indexes, packed at `depth` bits and prefixed with filter 0.
 *  Indexed data barely benefits from the other filters, and none is what the
 *  shipped assets use. */
function scanlines(indexes, width, height, depth) {
  const perByte = 8 / depth;
  const stride = Math.ceil(width / perByte);
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1) + 1; // leave the filter byte at 0
    for (let x = 0; x < width; x++) {
      const index = indexes[y * width + x];
      if (depth === 8) {
        raw[start + x] = index;
      } else {
        const shift = 8 - depth * ((x % perByte) + 1);
        raw[start + Math.floor(x / perByte)] |= index << shift;
      }
    }
  }
  return raw;
}

/**
 * @param imageData  what the canvas holds
 * @returns          PNG bytes, colour type 3
 */
export async function encodeIndexed(imageData) {
  const { data, width, height } = imageData;
  const counts = histogram(data);
  const palette =
    counts.size <= MAX_COLOURS ? [...counts.keys()].map(parts) : medianCut(counts, MAX_COLOURS);

  const indexes = indexPixels(data, palette);
  const depth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = depth;
  header[9] = 3; // colour type: palette
  // 10-12 stay zero: deflate, filter method 0, no interlace.

  const plte = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    plte[i * 3] = palette[i][0];
    plte[i * 3 + 1] = palette[i][1];
    plte[i * 3 + 2] = palette[i][2];
  }

  // tRNS carries alpha, and only up to the last entry that has any: a picture
  // with no transparency writes no chunk at all.
  const alpha = palette.map((colour) => colour[3]);
  let last = alpha.length - 1;
  while (last >= 0 && alpha[last] === 255) last--;
  const trns = last >= 0 ? Uint8Array.from(alpha.slice(0, last + 1)) : null;

  const idat = await deflate(scanlines(indexes, width, height, depth));

  const chunks = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', plte),
    ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];

  const size = chunks.reduce((total, part) => total + part.length, 0);
  const png = new Uint8Array(size);
  let at = 0;
  for (const part of chunks) {
    png.set(part, at);
    at += part.length;
  }
  return png.buffer;
}

export const available = () => typeof CompressionStream === 'function';
