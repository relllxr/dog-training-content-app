// The repository as the reader sees it: one tree call, then blobs on demand.
//
// Asset resolution follows docs/assets.md, including the two implicit links —
// an item preview is found by name alone (`preview_<itemId>`), and a
// troubleshooting card's file carries a `preview_` prefix its imageId does not.

import * as gh from './gh.js';
import * as cache from './cache.js';
import { REF } from '../config.js';

const decoder = new TextDecoder();

const state = {
  ref: REF,
  head: null, // commit the file list was read at; null when the ref is not a branch
  files: new Map(), // path -> sha
  items: new Map(), // id   -> path
  releases: [], // release ids, newest first
  loaded: new Map(), // path -> parsed json
  urls: new Map(), // path -> object url
  inflight: new Map(),
};

export const ref = () => state.ref;
export const head = () => state.head;
export const releases = () => state.releases;
export const itemIds = () => [...state.items.keys()];
export const hasFile = (path) => state.files.has(path);

/** Reads the file list. Everything else is derived from it. */
export async function loadTree() {
  // The branch head first, then the tree at that exact commit. The sha is what
  // an upload commits on top of, and reading the tree by branch name could
  // otherwise straddle someone else's push. A ref that is not a branch leaves
  // head null and uploading is off for that view.
  state.head = await newerHead(state.head, await gh.branchHead(state.ref).catch(() => null));
  const data = await gh.tree(state.head || state.ref);
  state.files.clear();
  state.items.clear();
  state.loaded.clear();
  const releases = new Set();

  for (const entry of data.tree) {
    if (entry.type !== 'blob') continue;
    state.files.set(entry.path, entry.sha);
    const item = entry.path.match(/^content\/([^/]+)\.json$/);
    if (item) state.items.set(item[1], entry.path);
    const release = entry.path.match(/^releases\/([^/]+)\/release\.json$/);
    if (release) releases.add(release[1]);
  }

  // v1.10 before v1.9, and v1.10 before v1.2 — compare version parts as numbers.
  state.releases = [...releases].sort((a, b) => compareVersions(b, a));

  if (data.truncated) {
    console.warn('The tree came back truncated; some files are missing from the index.');
  }
  return { count: state.files.size, truncated: !!data.truncated };
}

/**
 * Refresh must never wind the page back.
 *
 * A head that comes back older than the one this page already holds — a replica
 * behind, a read a cache answered — used to be adopted anyway, and then the
 * tree was read at it. The page would show the repository as it was before the
 * last upload: the picture committed a moment ago disappears, and the next
 * upload is built on a parent one commit behind the branch, which GitHub then
 * correctly refuses as not a fast forward. Losing visible work reads as losing
 * data even when nothing is lost, so of two heads this keeps the one in front.
 */
async function newerHead(known, remote) {
  if (!known || !remote || known === remote) return remote;
  // The same question T2 asks in write.js, answered the same way. A compare
  // that cannot be had leaves the page on what it already holds; the next
  // Refresh picks the branch up, and nothing has been shown as current that is
  // not a real commit of this branch.
  const status = await gh.compare(known, remote).catch(() => 'behind');
  return status === 'behind' || status === 'identical' ? known : remote;
}

function compareVersions(a, b) {
  const parts = (v) => v.replace(/^v/, '').split('.').map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return a.localeCompare(b);
}

async function bytes(path) {
  const sha = state.files.get(path);
  if (!sha) throw new Error(`${path} is not in the tree`);
  const cached = await cache.get(sha);
  if (cached) return cached;
  if (state.inflight.has(sha)) return state.inflight.get(sha);
  const job = gh
    .blob(sha)
    .then(async (data) => {
      await cache.put(sha, data);
      state.inflight.delete(sha);
      return data;
    })
    .catch((e) => {
      state.inflight.delete(sha);
      throw e;
    });
  state.inflight.set(sha, job);
  return job;
}

export async function json(path) {
  if (state.loaded.has(path)) return state.loaded.get(path);
  const parsed = JSON.parse(decoder.decode(await bytes(path)));
  state.loaded.set(path, parsed);
  return parsed;
}

export async function item(id) {
  const path = state.items.get(id);
  if (!path) return null;
  return json(path);
}

export function itemSync(id) {
  const path = state.items.get(id);
  return path ? state.loaded.get(path) : undefined;
}

/** Pulls every item so lists can show titles without a request per row. */
export async function loadAllItems(onProgress) {
  const missing = [...state.items.values()].filter((p) => !state.loaded.has(p));
  await gh.pool(
    missing.map((path) => () => json(path).catch((e) => e)),
    8,
    onProgress,
  );
}

export async function release(id) {
  const manifest = await json(`releases/${id}/release.json`);
  const [programs, explore] = await Promise.all([
    json(`releases/${id}/${manifest.programs || 'programs.json'}`),
    json(`releases/${id}/${manifest.explore || 'explore.json'}`),
  ]);
  return { id, manifest, programs, explore };
}

// ------------------------------------------------------------------ assets

const FOLDER = {
  cover: (imageId) => `images/covers/${imageId}`,
  screen: (imageId) => `images/content/${imageId}`,
  preview: (itemId) => `images/previews/preview_${itemId}`,
  card: (imageId) => `images/troubleshooting/preview_${imageId}`,
};

/** The file backing an imageId, preferring @2x — 2x phone width is enough here. */
export function assetPath(kind, name) {
  if (!name) return null;
  const stem = FOLDER[kind](name);
  for (const density of ['@2x', '@3x']) {
    const path = `${stem}${density}.png`;
    if (state.files.has(path)) return path;
  }
  return null;
}

/** The path an asset takes minus its density suffix — where an upload writes. */
export const assetStem = (kind, name) => FOLDER[kind](name);

/** Which screens and steps point at an asset — what a redraw would change. */
export function usesOfImageId(imageId) {
  const out = [];
  for (const [id, path] of state.items) {
    const item = state.loaded.get(path);
    if (!item) continue;
    if (item.imageId === imageId) out.push(`${id} cover`);
    for (const screen of item.screens || []) {
      if (screen.imageId === imageId) out.push(`${id} / ${screen.id}`);
    }
    for (const step of item.steps || []) {
      if (step.imageId === imageId) out.push(`${id} step ${step.index}`);
    }
  }
  return out;
}

/** An object URL for an asset, fetched once and kept for the session. */
export async function assetUrl(path) {
  if (state.urls.has(path)) return state.urls.get(path);
  const data = await bytes(path);
  const url = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
  state.urls.set(path, url);
  return url;
}

/**
 * Folds a commit the app just made into what it already holds, instead of
 * re-reading 61 items to learn about three files. Blobs are content-addressed,
 * so the new bytes can go straight into the cache under their new sha.
 */
export function applyCommit(commitSha, entries) {
  state.head = commitSha;
  for (const entry of entries) {
    state.files.set(entry.path, entry.sha);
    if (entry.bytes) cache.put(entry.sha, entry.bytes);
    if (entry.json !== undefined) state.loaded.set(entry.path, entry.json);
    // A replaced picture keeps its path, so the old object URL has to go or the
    // page would keep showing what was there before.
    const url = state.urls.get(entry.path);
    if (url) {
      URL.revokeObjectURL(url);
      state.urls.delete(entry.path);
    }
  }
}

/**
 * Re-reads where the branch points and takes it, without re-reading the tree.
 *
 * The one place a remote head genuinely ahead of this page is adopted rather
 * than refused, and it takes an explicit click to get here: the retry button
 * the upload dialog shows after GitHub declined to fast-forward (upload.js).
 * The person has been told what happened and asked for the commit to go on top
 * of what is there now. Everything automatic goes through `newerHead` instead.
 */
export async function refreshHead() {
  const remote = await gh.branchHead(state.ref).catch(() => null);
  if (remote) state.head = remote;
  return state.head;
}

// -------------------------------------------------------------- composition

/** Programs are keyed by (id, audience.dogAge) — an id alone collapses tracks. */
export const collectionKey = (collection) =>
  collection.audience?.dogAge ? `${collection.id}~${collection.audience.dogAge}` : collection.id;

export function allCollections(rel) {
  const out = [];
  for (const collection of rel.programs?.collections || []) out.push(collection);
  for (const section of rel.explore?.sections || []) {
    for (const collection of section.collections || []) out.push(collection);
  }
  return out;
}

export function findCollection(rel, key) {
  return allCollections(rel).find((c) => collectionKey(c) === key) || null;
}
