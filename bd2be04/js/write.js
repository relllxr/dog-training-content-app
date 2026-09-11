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
// than committing a patch onto a file it has not seen — but only if they really
// did: a remote head that is an ancestor of ours is a stale read, not a push,
// and refusing on it was the whole of the "main moved on" bug.

import * as gh from './gh.js';
import * as data from './data.js';
import * as who from './who.js';
import { base64 } from './resize.js';

export class StaleError extends Error {}

// One upload at a time.
//
// A commit is five calls with a picture's bytes inside them, so two dialogs
// confirmed a second apart can both pass the head check and then race: the
// second builds its commit on a head the first has already moved, and whichever
// loses is a non-fast-forward. Chaining them costs nothing on the ordinary path
// — the second reads the head after the first has landed.
let queue = Promise.resolve();

/**
 * @param message  commit subject and body
 * @param files    [{ path, bytes }] for binaries, [{ path, text, json }] for JSON
 * @returns        { sha, entries } — entries carry the new blob shas
 */
export function commitFiles(message, files) {
  // A failed upload must not stop the next one, so the tail the queue keeps is
  // the settled one and the caller gets the rejection.
  const mine = queue.then(
    () => commit(message, files),
    () => commit(message, files),
  );
  queue = mine.catch(() => {});
  return mine;
}

async function commit(message, files) {
  const known = data.head();
  if (!known) {
    throw new Error(`${data.ref()} is not a branch in this view, so nothing can be written to it.`);
  }

  // A head that differs from ours is not by itself a conflict. It is also what
  // a read a few seconds stale looks like, and what this page looks like from
  // a replica that has not caught up with the commit it just made: the page is
  // *ahead* of what it reads, not behind. So ask which way the two differ
  // before refusing — `compare/{known}...{remote}` says where the remote sits.
  const remote = await gh.branchHead(data.ref());
  if (remote !== known) {
    // A compare that cannot be had is treated as the conflict it might be.
    const status = await gh.compare(known, remote).catch(() => 'diverged');
    if (status !== 'behind' && status !== 'identical') {
      throw new StaleError(
        `${data.ref()} moved on since this page was loaded. Hit Refresh and try again — the change would otherwise be written on top of a file this page has not read.`,
      );
    }
    // `behind`: the remote is an ancestor of the head this page holds, so it is
    // carrying nothing we have not seen. `known` is still the parent, and
    // moving the branch onto a descendant of the remote still fast-forwards.
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
  const tree = await gh.createTree(await gh.commitTree(known), entries);
  const sha = await gh.createCommit(message, tree, [known], who.me());
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
