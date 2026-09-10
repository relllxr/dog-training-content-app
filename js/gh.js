// GitHub REST client. Everything the reader shows, and everything it writes,
// comes through here.
//
// The token is the viewer's own fine-grained PAT, kept in localStorage and sent
// as a bearer. Nothing is bundled with the app and nothing is proxied: the
// shell is public, the content is not, and the token is what separates them.
//
// Reading needs Contents: Read-only. Uploading a picture needs Contents: Read
// and write — the same token, one permission wider. Review notes add Issues,
// Read to see them and Read and write to post; a token without it loses the
// notes and nothing else.

import { REPO, TOKEN_KEY } from '../config.js';

const API = 'https://api.github.com';
const VERSION = '2022-11-28';

let token = localStorage.getItem(TOKEN_KEY) || '';

export const hasToken = () => token !== '';
export const tokenHint = () => (token ? `${token.slice(0, 11)}…${token.slice(-4)}` : '');

export function setToken(value) {
  token = value.trim();
  localStorage.setItem(TOKEN_KEY, token);
}

export function forgetToken() {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
}

export class GitHubError extends Error {
  constructor(message, status, { rateLimited = false, readOnly = false, conflict = false } = {}) {
    super(message);
    this.status = status;
    this.rateLimited = rateLimited;
    this.readOnly = readOnly;
    this.conflict = conflict;
  }
}

// What a write needs, per permission, said in the words of the token screen.
const WIDER = {
  Contents: 'Uploading a picture needs Contents: Read and write; reading needs only Read.',
  Issues: 'Posting a note needs Issues: Read and write; reading them needs only Read.',
};

async function explain(res, writing, need) {
  let message = '';
  try {
    const body = await res.json();
    message = body?.message || '';
  } catch {
    /* an error body is not guaranteed to be JSON */
  }

  if (res.status === 401) {
    return new GitHubError('The token was rejected. It may have expired or been revoked.', 401);
  }
  // A token allowed to read but not write answers 403 on a write, and a token
  // without the repository at all answers 404 on everything — GitHub does not
  // confirm that a private repository exists.
  if (writing && (res.status === 403 || res.status === 404)) {
    return new GitHubError(
      `This token cannot write to ${REPO.owner}/${REPO.repo}. ${WIDER[need] || WIDER.Contents}`,
      res.status,
      { readOnly: true },
    );
  }
  if (res.status === 404) {
    return new GitHubError(
      `${REPO.owner}/${REPO.repo} is not visible to this token. Check that the token grants it Contents: read.`,
      404,
    );
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const at = Number.isFinite(reset) ? new Date(reset).toLocaleTimeString() : 'shortly';
      return new GitHubError(`GitHub rate limit reached. It resets at ${at}.`, res.status, {
        rateLimited: true,
      });
    }
    return new GitHubError(message || 'GitHub refused the request.', res.status);
  }
  if (res.status === 409 || res.status === 422) {
    return new GitHubError(message || `GitHub answered ${res.status}.`, res.status, { conflict: true });
  }
  return new GitHubError(message || `GitHub answered ${res.status}.`, res.status);
}

async function request(path, accept, { method = 'GET', body, need = 'Contents' } = {}) {
  if (!token) throw new GitHubError('No token yet.', 401);
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        'X-GitHub-Api-Version': VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new GitHubError('Could not reach api.github.com. Check the connection.', 0);
  }
  if (!res.ok) throw await explain(res, method !== 'GET', need);
  return res;
}

const send = async (path, method, body, need) => {
  const res = await request(path, 'application/vnd.github+json', { method, body, need });
  return res.json();
};

const base = () => `/repos/${REPO.owner}/${REPO.repo}`;

// A branch name keeps its slashes in the path, so it is escaped segment by
// segment: `feature/x` is two path segments, not one with a %2F in it.
const refPath = (branch) => branch.split('/').map(encodeURIComponent).join('/');

/** Confirms the token can see the repository, and returns what it says about it. */
export async function repository() {
  const res = await request(base(), 'application/vnd.github+json');
  return res.json();
}

/** The whole file list in one call: path, type and blob sha for every entry. */
export async function tree(ref) {
  const res = await request(
    `${base()}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    'application/vnd.github+json',
  );
  return res.json();
}

/** Raw bytes of a blob. Blobs are content-addressed, so callers can cache forever. */
export async function blob(sha) {
  const res = await request(`${base()}/git/blobs/${sha}`, 'application/vnd.github.raw');
  return res.arrayBuffer();
}

// -------------------------------------------------------------------- writes
//
// One picture is three files — @2x, @3x and the JSON that names them — and they
// have to land together or not at all. The Contents API commits one file per
// call, so an upload would be three commits with two broken states between
// them. The Git Data API builds the whole commit first and moves the branch
// once, which is why the write path is these five calls and not one.

/** Where a branch points right now. The parent of anything we commit. */
export async function branchHead(branch) {
  const res = await request(`${base()}/git/ref/heads/${refPath(branch)}`, 'application/vnd.github+json');
  return (await res.json()).object.sha;
}

/** The tree a commit carries — the base every new tree is layered onto. */
export async function commitTree(sha) {
  const res = await request(`${base()}/git/commits/${sha}`, 'application/vnd.github+json');
  return (await res.json()).tree.sha;
}

/** Stores one file's bytes and returns its blob sha. Nothing references it yet. */
export async function createBlob(content, encoding) {
  return (await send(`${base()}/git/blobs`, 'POST', { content, encoding })).sha;
}

/** A tree that is `baseTree` with `entries` laid over it. */
export async function createTree(baseTree, entries) {
  const tree = entries.map(({ path, sha }) => ({ path, mode: '100644', type: 'blob', sha }));
  return (await send(`${base()}/git/trees`, 'POST', { base_tree: baseTree, tree })).sha;
}

/**
 * `author` names the person who made the change. Every token here belongs to
 * the same account, so without it `git log` would credit that account for
 * everyone's work; with it, and with no `committer` beside it, GitHub takes
 * the author for both lines. See who.js.
 */
export async function createCommit(message, tree, parents, author) {
  const body = { message, tree, parents, ...(author ? { author } : {}) };
  return (await send(`${base()}/git/commits`, 'POST', body)).sha;
}

/** Moves the branch. `force` stays off, so a branch that moved under us fails. */
export async function updateRef(branch, sha) {
  return send(`${base()}/git/refs/heads/${refPath(branch)}`, 'PATCH', { sha, force: false });
}

// -------------------------------------------------------------------- notes
//
// Review threads are issues (see comments.js). All of it is one permission
// apart from the rest: a token with only Contents fails here and nowhere else,
// which is why every one of these calls says Issues when it explains itself.

const issue = (path, method, body) => send(`${base()}/issues${path}`, method, body, 'Issues');

/** One page of issues, newest first, open and closed. Pull requests included. */
export async function issues(page) {
  const res = await request(`${base()}/issues?state=all&per_page=100&page=${page}`, 'application/vnd.github+json', {
    need: 'Issues',
  });
  return res.json();
}

export const createIssue = (title, body, labels) => issue('', 'POST', { title, body, labels });

export async function issueComments(number) {
  const res = await request(`${base()}/issues/${number}/comments?per_page=100`, 'application/vnd.github+json', {
    need: 'Issues',
  });
  return res.json();
}

export const addComment = (number, body) => issue(`/${number}/comments`, 'POST', { body });

/** Closing a thread is resolving it; `state_reason` keeps it out of "not planned". */
export const setIssueState = (number, state) =>
  issue(`/${number}`, 'PATCH', { state, state_reason: state === 'closed' ? 'completed' : 'reopened' });

/** Creates the label if the repository has not got it. 422 means it already has. */
export async function ensureLabel(name, color, description) {
  try {
    await send(`${base()}/labels`, 'POST', { name, color, description }, 'Issues');
  } catch (e) {
    if (e.status !== 422) throw e;
  }
}

/** Runs `jobs` with a bounded number in flight; GitHub dislikes a burst of 60. */
export async function pool(jobs, limit = 8, onProgress) {
  let index = 0;
  let done = 0;
  const results = new Array(jobs.length);
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (index < jobs.length) {
      const mine = index++;
      try {
        results[mine] = await jobs[mine]();
      } catch (e) {
        results[mine] = e;
      }
      if (onProgress) onProgress(++done, jobs.length);
    }
  });
  await Promise.all(workers);
  return results;
}
