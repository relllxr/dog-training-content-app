// Content-addressed blob cache in IndexedDB.
//
// Keys are git blob shas, so an entry can never go stale: a changed file is a
// different sha. Only the tree call goes to the network on a warm start.

const DB_NAME = 'pawzi-content';
const STORE = 'blobs';

const memory = new Map();
let connection;

function open() {
  if (connection) return connection;
  connection = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null); // storage blocked (private window, site data off)
      return;
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return connection;
}

export async function get(sha) {
  if (memory.has(sha)) return memory.get(sha);
  const db = await open();
  if (!db) return undefined;
  const value = await new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(sha);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
  if (value !== undefined) memory.set(sha, value);
  return value;
}

export async function put(sha, bytes) {
  memory.set(sha, bytes);
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, sha);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function clear() {
  memory.clear();
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
