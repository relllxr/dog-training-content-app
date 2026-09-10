// One commit, or nothing.
//
// A picture arriving in the repository is three files — the asset at @2x, at
// @3x, and the JSON that starts pointing at it. The Contents API writes one
// file per commit, which would put two broken states in the history and leave a
// race between them. So the whole commit is assembled through the Git Data API
// (blobs -> tree -> commit) and the branch is moved once at the end.
//
// The branch is moved without force, and the head is checked against the one
// the file list was read at. If anyone pushed in between, this refuses rather
// than committing a patch onto a file it has not seen.

import * as gh from './gh.js';
import * as data from './data.js';
import { base64 } from './resize.js';

export class StaleError extends Error {}

/**
 * @param message  commit subject and body
 * @param files    [{ path, bytes }] for binaries, [{ path, text, json }] for JSON
 * @returns        { sha, entries } — entries carry the new blob shas
 */
export async function commitFiles(message, files) {
  const known = data.head();
  if (!known) {
    throw new Error(`${data.ref()} is not a branch in this view, so nothing can be written to it.`);
  }

  const head = await gh.branchHead(data.ref());
  if (head !== known) {
    throw new StaleError(
      `${data.ref()} moved on since this page was loaded. Hit Refresh and try again — the change would otherwise be written on top of a file this page has not read.`,
    );
  }

  const shas = [];
  for (const file of files) {
    shas.push(
      file.text !== undefined
        ? await gh.createBlob(file.text, 'utf-8')
        : await gh.createBlob(base64(file.bytes), 'base64'),
    );
  }

  const entries = files.map((file, i) => ({ ...file, sha: shas[i] }));
  const tree = await gh.createTree(await gh.commitTree(head), entries);
  const sha = await gh.createCommit(message, tree, [head]);
  await gh.updateRef(data.ref(), sha);

  return { sha, entries };
}

// ------------------------------------------------------------- json patching

/**
 * Sets `imageId` on an object, in the place the repository already puts it:
 * before `screens` on an item, before `items` on a release collection, and
 * last on a screen or a step — which is where those already carry it.
 */
export function setImageId(target, value) {
  const before = Object.entries(target);
  if ('imageId' in target) {
    target.imageId = value;
    return before;
  }

  const rebuilt = [];
  let placed = false;
  for (const [key, existing] of before) {
    if (!placed && (key === 'screens' || key === 'items')) {
      rebuilt.push(['imageId', value]);
      placed = true;
    }
    rebuilt.push([key, existing]);
  }
  if (!placed) rebuilt.push(['imageId', value]);

  restore(target, rebuilt);
  return before;
}

/** Puts an object back the way `setImageId` found it, when a commit fails. */
export function restore(target, entries) {
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of entries) target[key] = value;
}

/** How every JSON file in this repository is written: two spaces, one newline. */
export const serialize = (doc) => `${JSON.stringify(doc, null, 2)}\n`;
