// The panel a note is written in, and the button that opens it.
//
// It sits beside the content rather than over it: a note is written while
// looking at the screen it is about, and a modal would take that away. There is
// one panel for the whole page, parked on <body>, so a repaint of the page
// underneath — which every posted note causes, to keep the counts honest —
// leaves it open and scrolled where it was.

import { el } from './views.js';
import * as comments from './comments.js';
import * as gh from './gh.js';
import * as who from './who.js';

// ------------------------------------------------------------------- button

/**
 * The affordance on a card. `context` is what a new thread would be about:
 *
 *   { anchor, title, subject }
 *
 * `title` is the issue title, `subject` the sentence under the note that says
 * what is being discussed. Both are written once, when the thread is opened.
 */
export function threadButton(context, { compact = false } = {}) {
  const found = comments.threadFor(context.anchor);
  const label = !found ? 'Note' : found.open ? String(found.replies + 1) : '✓';

  return el('button', {
    type: 'button',
    class: `thread-btn${found ? (found.open ? ' thread-btn-open' : ' thread-btn-done') : ''}${compact ? ' thread-btn-compact' : ''}`,
    title: !comments.available()
      ? comments.reason()
      : found
        ? `${found.open ? 'Open note' : 'Resolved note'}: ${found.title}`
        : `Leave a note on ${context.subject}`,
    disabled: !comments.available(),
    onclick: (e) => {
      // Cards are links; the button is inside one.
      e.preventDefault();
      e.stopPropagation();
      open(context);
    },
  }, icon(), el('span', { class: 'thread-btn-count', text: label }));
}

const icon = () => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('class', 'thread-btn-icon');
  node.setAttribute('fill', 'currentColor');
  node.innerHTML =
    '<path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9.4L5 21.5A1 1 0 0 1 3.4 20.7V18H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>';
  return node;
};

/** Open threads on any part of an item, for a card in a list. */
export function itemNoteBadge(itemId) {
  const { open: openCount } = comments.countsFor(itemId);
  if (!openCount) return null;
  return el('span', {
    class: 'badge badge-thread',
    text: `${openCount} note${openCount === 1 ? '' : 's'}`,
    title: `${openCount} open note${openCount === 1 ? '' : 's'} on this item`,
  });
}

// -------------------------------------------------------------------- panel

let panel;
let current = null;

function ensurePanel() {
  if (panel) return panel;
  panel = el('aside', { class: 'thread', hidden: true });
  document.body.append(panel);
  document.addEventListener('keydown', (e) => {
    // Escape belongs to the panel only when nothing modal is on top of it.
    if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) close();
  });
  return panel;
}

export function close() {
  current = null;
  if (panel) {
    panel.hidden = true;
    panel.replaceChildren();
  }
  document.body.classList.remove('thread-on');
}

export async function open(context) {
  const node = ensurePanel();
  current = context.anchor;
  node.hidden = false;
  document.body.classList.add('thread-on');

  const found = comments.threadFor(context.anchor);
  const list = el('div', { class: 'thread-list' });
  node.replaceChildren(head(context, found), list, composer(context, found));

  if (!found) {
    list.append(
      el('p', { class: 'thread-empty' }, 'No notes here yet. The first one opens a GitHub issue anchored to ', el('code', { text: context.anchor }), '.'),
    );
    return;
  }

  list.append(el('p', { class: 'thread-empty', text: 'Reading the thread…' }));
  try {
    const all = await comments.messages(found);
    if (current !== context.anchor) return; // moved on while it loaded
    list.replaceChildren(...all.map(message));
    list.scrollTop = list.scrollHeight;
  } catch (e) {
    if (current !== context.anchor) return;
    list.replaceChildren(el('p', { class: 'error', text: e.message }));
  }
}

/** Redraws the open panel — after a post, so the new message is in the thread. */
const reopen = (context) => open(context);

function head(context, found) {
  return el(
    'header',
    { class: 'thread-head' },
    el(
      'div',
      { class: 'thread-title' },
      el(
        'div',
        { class: 'thread-name' },
        el('h2', { text: found ? found.title : context.title }),
        found
          ? el('span', {
              class: `badge ${found.open ? 'badge-thread' : 'badge-resolved'}`,
              text: found.open ? 'open' : 'resolved',
            })
          : el('span', { class: 'badge badge-draft', text: 'new' }),
      ),
      el('p', { class: 'muted', text: context.subject }),
    ),
    el(
      'div',
      { class: 'thread-tools' },
      found
        ? el('a', {
            class: 'ghost button',
            href: found.url,
            target: '_blank',
            rel: 'noreferrer',
            text: `#${found.number}`,
            title: 'Open the issue on GitHub',
          })
        : null,
      found
        ? el('button', {
            class: 'ghost',
            text: found.open ? 'Resolve' : 'Reopen',
            title: found.open ? 'Close the issue' : 'Reopen the issue',
            onclick: async (e) => {
              const button = e.currentTarget;
              button.disabled = true;
              try {
                await comments.resolve(found, found.open);
                reopen(context);
              } catch (err) {
                button.disabled = false;
                fail(err);
              }
            },
          })
        : null,
      el('button', { class: 'ghost thread-close', text: '✕', title: 'Close the panel', onclick: () => close() }),
    ),
  );
}

function message(msg) {
  return el(
    'article',
    { class: 'msg' },
    el(
      'div',
      { class: 'msg-head' },
      el('b', { text: msg.author }),
      // Written on GitHub rather than here: no signature, so the name shown is
      // the account, and saying so is more honest than letting it pass as one.
      msg.author === msg.account ? el('span', { class: 'muted msg-account', text: 'via GitHub' }) : null,
      el('time', { class: 'muted', datetime: msg.at, title: new Date(msg.at).toLocaleString(), text: ago(msg.at) }),
    ),
    el('div', { class: 'msg-body' }, ...rich(msg.text)),
  );
}

function composer(context, found) {
  const box = el('textarea', {
    class: 'thread-input',
    rows: '3',
    placeholder: found ? 'Reply…' : `What is wrong with ${context.subject}?`,
    oninput: () => {
      post.disabled = !box.value.trim();
    },
    onkeydown: (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !post.disabled) send();
    },
  });

  const problem = el('p', { class: 'error' });
  const post = el('button', {
    class: 'primary',
    text: found ? 'Reply' : 'Open note',
    disabled: true,
    onclick: () => send(),
  });

  async function send() {
    const text = box.value.trim();
    // The note is signed, so the name is asked for before it is sent.
    if (!(await who.ensure())) return;
    post.disabled = true;
    post.textContent = 'Posting…';
    problem.textContent = '';
    try {
      const live = comments.threadFor(context.anchor);
      if (live) await comments.reply(live, text);
      else await comments.open({ ...context, link: location.href }, text);
      reopen(context);
    } catch (e) {
      problem.textContent = e instanceof gh.GitHubError ? e.message : `Could not post: ${e.message}`;
      post.textContent = found ? 'Reply' : 'Open note';
      post.disabled = false;
    }
  }

  return el(
    'form',
    { class: 'thread-new', onsubmit: (e) => e.preventDefault() },
    box,
    problem,
    el(
      'div',
      { class: 'thread-actions' },
      el('span', { class: 'muted', text: '⌘↵ to post' }),
      post,
    ),
  );
}

const fail = (e) => {
  const problem = panel?.querySelector('.thread-new .error');
  if (problem) problem.textContent = e.message;
};

// ------------------------------------------------------------------ display

const UNITS = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [2592000, 'day', 86400],
  [31536000, 'month', 2592000],
  [Infinity, 'year', 31536000],
];

function ago(iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 45) return 'just now';
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [limit, unit, size] of UNITS) {
    if (seconds < limit) return format.format(-Math.round(seconds / size), unit);
  }
  return iso.slice(0, 10);
}

// GitHub renders the full markdown; this shows the part of it people write in a
// review note. It builds nodes rather than HTML — the reader holds a token, and
// nothing typed into an issue should ever become markup on this page.
const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;

function inline(text) {
  const nodes = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) nodes.push(text.slice(at, match.index));
    const [, code, bold, italic, linkText, linkHref, bare] = match;
    if (code !== undefined) nodes.push(el('code', { text: code }));
    else if (bold !== undefined) nodes.push(el('b', { text: bold }));
    else if (italic !== undefined) nodes.push(el('i', { text: italic }));
    else if (linkText !== undefined) nodes.push(link(linkHref, linkText));
    else nodes.push(link(bare, bare));
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push(text.slice(at));
  return nodes;
}

const link = (href, text) => el('a', { class: 'msg-link', href, target: '_blank', rel: 'noreferrer noopener', text });

function rich(text) {
  return text.split(/\n{2,}/).map((paragraph) => {
    const lines = paragraph.split('\n');
    const nodes = [];
    lines.forEach((line, i) => {
      if (i) nodes.push(el('br', {}));
      nodes.push(...inline(line));
    });
    return el('p', {}, ...nodes);
  });
}
