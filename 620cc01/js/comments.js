// Review notes, kept as GitHub Issues.
//
// A note is anchored to something you can point at while reading: an item, one
// of its screens, its training steps screen, or one of its steps. The anchor is written into the
// issue body as an HTML comment, and that marker is what the reader matches on
// — not the title, which people rewrite, and not a label, which can be dropped
// by anyone tidying the repository.
//
// Issues rather than a store of the reader's own, for one reason: a note has to
// be readable outside the reader. `gh issue list --label content-comment` is
// the whole integration, and it is what turns a review into an agent's input —
// "rewrite the screens that have open notes". See docs/comments.md.
//
// Reading threads needs Issues: Read on the token, posting needs Read and
// write. Neither is needed to read the content, so a token without them loses
// the notes and nothing else: the index simply reports why it is empty.

import * as gh from './gh.js';
import * as who from './who.js';

/** Issues carry it for `gh`; the reader never relies on it being there. */
export const LABEL = 'content-comment';

// The marker the reader matches on. Written once, never rewritten: an edited
// body keeps its anchor as long as this line survives.
const MARKER = /<!--\s*pawzi:anchor\s+([^\s>]+)\s*-->/;

// What the composer appends under a note: the marker, plus the sentence that
// tells a reader of the issue what is being discussed.
const FOOTER = /\n*---\n<sub><!--\s*pawzi:anchor[\s\S]*$/;

const MAX_PAGES = 10; // 1000 issues; a content repository will not see it

const state = {
  ready: false,
  reason: '',
  threads: new Map(), // anchor -> thread
  labelChecked: false,
};

/** Whether the token could read the issues at all. */
export const available = () => state.ready;

/** Why not, when it could not. */
export const reason = () => state.reason;

// ------------------------------------------------------------------ anchors
//
// An item id is unique in content/ and a screen id is unique inside its item,
// so `<itemId>` and `<itemId>#<screenId>` name a thing for good. Steps are
// numbered rather than named, hence `#step-<n>`. The training steps screen as a
// whole — the one phone in Mobile View that shows all of them — is `#steps`.
// Both share the part after `#` with screen ids, and hold for the same reason:
// no screen in content/ is called `steps` or `step-1`, and one that was would
// only collide inside its own item.

export const itemAnchor = (itemId) => itemId;
export const screenAnchor = (itemId, screenId) => `${itemId}#${screenId}`;
export const stepsAnchor = (itemId) => `${itemId}#steps`;
export const stepAnchor = (itemId, index) => `${itemId}#step-${index}`;
export const anchorItem = (anchor) => anchor.split('#')[0];

// -------------------------------------------------------------------- index

/**
 * Reads every issue once and indexes the ones carrying an anchor. Never
 * throws: comments are an addition to the reader, not a condition of it.
 */
export async function load() {
  state.threads.clear();
  state.ready = false;
  state.reason = '';

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await gh.issues(page);
      for (const issue of batch) {
        // The issues endpoint returns pull requests too.
        if (issue.pull_request) continue;
        const anchor = issue.body?.match(MARKER)?.[1];
        if (anchor) state.threads.set(anchor, thread(issue, anchor));
      }
      if (batch.length < 100) break;
    }
    state.ready = true;
  } catch (e) {
    state.reason =
      e.status === 403 || e.status === 404 || e.status === 410
        ? 'Notes need Issues: Read on the token — the content reads without it.'
        : e.message;
  }
  return state.ready;
}

function thread(issue, anchor) {
  // The account that owns the token opened the issue; the signature on the
  // body says who actually wrote it. Prefer the signature, fall back to the
  // account for anything written on GitHub directly.
  const signed = who.unsign((issue.body || '').replace(FOOTER, '').trim());
  return {
    anchor,
    number: issue.number,
    title: issue.title,
    open: issue.state === 'open',
    url: issue.html_url,
    account: issue.user?.login || 'someone',
    author: signed.name || issue.user?.login || 'someone',
    at: issue.created_at,
    text: signed.text,
    replies: issue.comments || 0,
  };
}

export const threadFor = (anchor) => state.threads.get(anchor) || null;

/** Open and total threads anywhere on an item — what a card in a list shows. */
export function countsFor(itemId) {
  let open = 0;
  let total = 0;
  for (const [anchor, found] of state.threads) {
    if (anchor !== itemId && !anchor.startsWith(`${itemId}#`)) continue;
    total++;
    if (found.open) open++;
  }
  return { open, total };
}

// ----------------------------------------------------------------- messages

/** The whole thread: the issue body, then its comments. One call. */
export async function messages(found) {
  const first = { author: found.author, account: found.account, at: found.at, text: found.text, url: found.url };
  if (!found.replies) return [first];
  const rest = await gh.issueComments(found.number);
  return [
    first,
    ...rest.map((comment) => {
      const signed = who.unsign((comment.body || '').trim());
      const account = comment.user?.login || 'someone';
      return {
        author: signed.name || account,
        account,
        at: comment.created_at,
        text: signed.text,
        url: comment.html_url,
      };
    }),
  ];
}

// ------------------------------------------------------------------- writes

/**
 * Opens a thread. `subject` is the sentence that says what is being discussed;
 * it goes under the note so the issue reads on its own in `gh` or on GitHub.
 *
 * @param context { anchor, title, subject, link }
 */
export async function open(context, text) {
  await ensureLabel();
  const issue = await gh.createIssue(context.title, compose(text, context), [LABEL]);
  const found = thread(issue, context.anchor);
  state.threads.set(context.anchor, found);
  announce();
  return found;
}

export async function reply(found, text) {
  await gh.addComment(found.number, who.sign(text));
  found.replies += 1;
  announce();
  return found;
}

/** Closing is resolving: `--state open` is then the list of what is still live. */
export async function resolve(found, done) {
  await gh.setIssueState(found.number, done ? 'closed' : 'open');
  found.open = !done;
  announce();
  return found;
}

// The note first, then the line saying what it is about. The marker sits inside
// that line rather than on one of its own, so tidying the issue means deleting
// a visible sentence, not an invisible comment. The link goes last: a URL with
// prose after it reads as one run-on sentence.
function compose(text, context) {
  const link = context.link ? ` Opened from ${context.link}` : '';
  return (
    `${who.sign(text)}\n\n---\n<sub><!-- pawzi:anchor ${context.anchor} -->${context.subject}. ` +
    `The marker in this line is how the reader finds this thread — please leave it.${link}</sub>\n`
  );
}

/**
 * The label is for `gh`, not for the reader, so its absence is not an error.
 * It is created on the first thread rather than at boot: a repository where
 * nobody comments should not grow a label for it.
 */
async function ensureLabel() {
  if (state.labelChecked) return;
  state.labelChecked = true;
  try {
    await gh.ensureLabel(LABEL, 'd4c5f9', 'A review note on a content item, screen or step');
  } catch {
    /* the issue still carries the name, and the index does not depend on it */
  }
}

/** Counts changed; whatever is on screen should say so. */
const announce = () => window.dispatchEvent(new CustomEvent('pawzi:thread'));
