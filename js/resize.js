// Turning a dropped picture into the two files the repository stores.
//
// Every asset exists at @2x and @3x of the point size its slot occupies, and a
// missing density is an error rather than a variant (docs/assets.md). The sizes
// are uniform per folder in v1.10 — covers 393pt wide, screen and step pictures
// 361, previews and troubleshooting cards 146 — so the rule is one number per
// kind:
//
//   @3x = the source capped at 3x the slot's point width
//   @2x = exactly two thirds of that
//
// Both come from the same source at the same aspect, nothing is ever upscaled,
// and a Figma export at 4000px stops being a 4000px file before it is committed.

import * as png from './png.js';

export const POINT_WIDTH = { cover: 393, screen: 361, preview: 146, card: 146 };

/** What v1.10 holds, for telling the designer their export is smaller than usual. */
export const SHIPPED_3X_WIDTH = { cover: 1179, screen: 1083, preview: 438, card: 438 };

function canvas(width, height) {
  const node = document.createElement('canvas');
  node.width = width;
  node.height = height;
  const ctx = node.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { node, ctx };
}

/**
 * Draws `source` at the given size. A browser filters one big downscale poorly,
 * so anything more than 2:1 is halved first — the difference is visible on the
 * thin lines these illustrations are made of.
 */
function scaled(source, width, height) {
  let current = source;
  let w = source.width;
  let h = source.height;

  while (w > width * 2 && h > height * 2) {
    w = Math.max(width, Math.round(w / 2));
    h = Math.max(height, Math.round(h / 2));
    const step = canvas(w, h);
    step.ctx.drawImage(current, 0, 0, w, h);
    current = step.node;
  }

  const out = canvas(width, height);
  out.ctx.drawImage(current, 0, 0, width, height);
  return out.node;
}

const encode = (node) =>
  new Promise((resolve, reject) => {
    node.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the picture as PNG.'))),
      'image/png',
    );
  });

async function density(bitmap, width, height) {
  const node = scaled(bitmap, width, height);
  const fallback = await (await encode(node)).arrayBuffer();

  // A palette PNG is what the repository holds and what the canvas will not
  // write; see png.js. Take it when it is available and actually smaller, which
  // for these flat illustrations it is by roughly eight to one.
  let bytes = fallback;
  let indexed = false;
  if (png.available()) {
    try {
      const packed = await png.encodeIndexed(node.getContext('2d').getImageData(0, 0, width, height));
      if (packed.byteLength < fallback.byteLength) {
        bytes = packed;
        indexed = true;
      }
    } catch (e) {
      console.warn('Falling back to the canvas encoder:', e);
    }
  }

  return { width, height, bytes, indexed };
}

/**
 * Reads a dropped file and renders both densities.
 * Returns the source's own dimensions too — the dialog says what came in.
 */
export async function prepare(file, kind) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} is not a picture this browser can read.`);
  }

  const cap = POINT_WIDTH[kind] * 3;
  const scale = Math.min(1, cap / bitmap.width);
  const w3 = Math.max(1, Math.round(bitmap.width * scale));
  const h3 = Math.max(1, Math.round(bitmap.height * scale));
  // Two thirds of the @3x size, so the pair is in the exact ratio the app expects.
  const w2 = Math.max(1, Math.round((w3 * 2) / 3));
  const h2 = Math.max(1, Math.round((h3 * 2) / 3));

  const source = {
    name: file.name,
    type: file.type,
    size: file.size,
    width: bitmap.width,
    height: bitmap.height,
  };

  const three = await density(bitmap, w3, h3);
  const two = await density(bitmap, w2, h2);
  bitmap.close?.(); // a closed bitmap reports width 0, so read it first

  return { two, three, source };
}

/** Base64 for the blobs API, in chunks — one spread of 700 KB blows the stack. */
export function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  const step = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
