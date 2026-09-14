// Boot, chrome and routing.
//
// Routes carry the release, so a link to a screen is a link to that screen in
// that release: #/v1.10/, #/v1.10/explore, #/v1.10/c/<key>, #/v1.10/i/<id>.

import * as gh from './gh.js';
import * as data from './data.js';
import * as cache from './cache.js';
import * as comments from './comments.js';
import * as thread from './thread.js';
import * as who from './who.js';
import * as views from './views.js';
import { mobileItemView } from './mobile.js';
import { el } from './views.js';
import { SLUG, REF, BUILD } from '../config.js';

const root = document.getElementById('root');
const state = { rel: null, loading: null };

// CRM or the app's own screens. Only item pages have mockups, so the switch is
// disabled elsewhere rather than silently doing nothing.
const MODE_KEY = 'pawzi.viewmode';
const mode = () => (localStorage.getItem(MODE_KEY) === 'mobile' ? 'mobile' : 'crm');

const show = (...nodes) => root.replaceChildren(...nodes);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  return {
    release: segments.shift() || null,
    rest: segments,
    params: new URLSearchParams(query || ''),
  };
}

const href = (releaseId) => (path, params) => {
  const query = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  return `#/${releaseId}/${path}${query}`;
};

// ------------------------------------------------------------------- chrome

function chrome(active) {
  const releaseSelect = el(
    'select',
    {
      class: 'release',
      title: 'Release',
      onchange: (e) => {
        location.hash = `#/${e.target.value}/`;
      },
    },
    data.releases().map((id) => el('option', { value: id, selected: id === state.rel.id }, id)),
  );

  const tab = (label, path) =>
    el('a', {
      class: `tab${active === path ? ' tab-on' : ''}`,
      href: href(state.rel.id)(path),
      text: label,
    });

  return el(
    'header',
    { class: 'chrome' },
    el(
      'div',
      { class: 'chrome-left' },
      el('a', { class: 'brand', href: href(state.rel.id)(''), text: 'Pawzi content' }),
      releaseSelect,
    ),
    el('nav', { class: 'tabs' }, tab('Programs', ''), tab('Library Tab', 'explore'), tab('All content items', 'library')),
    el('div', { class: 'chrome-search' }, searchField),
    el(
      'div',
      { class: 'chrome-right' },
      modeSwitch(active),
      // Notes are an addition, so their absence is said once and quietly
      // rather than by a disabled button on every card explaining itself.
      comments.available()
        ? null
        : el('span', { class: 'muted chip', text: 'notes off', title: comments.reason() }),
      // The name everything written from this browser is signed with. Visible
      // because a shared token makes it the only thing that says who you are.
      el('button', {
        class: `chip ghost who${who.known() ? '' : ' who-unset'}`,
        text: who.known() ? who.me().name : 'Set your name',
        title: who.known()
          ? `Pictures and notes are signed ${who.me().name} <${who.me().email}>. Click to change.`
          : 'The token is shared. Say who you are, so what you write carries your name.',
        onclick: () => who.edit(),
      }),
      // What is on screen, in one line: the content read from that repository
      // at that branch, through this build of the shell. The build is here
      // because a browser can hold an old bundle long after a publish, and a
      // reader who cannot see which one they have reports the old bug again.
      el('span', {
        class: 'muted repo',
        text: `${SLUG}@${REF} · ${BUILD}`,
        title:
          BUILD === 'dev'
            ? `Content from ${SLUG}@${REF}. Reader: the local working copy.`
            : `Content from ${SLUG}@${REF}. Reader built from ${BUILD}.`,
      }),
      el('button', {
        class: 'ghost',
        text: 'Refresh',
        title: 'Re-read the file list from GitHub',
        onclick: () => boot(),
      }),
      el('button', {
        class: 'ghost',
        text: 'Sign out',
        title: 'Forget the token and the name in this browser',
        onclick: () => {
          gh.forgetToken();
          who.forget();
          location.reload();
        },
      }),
    ),
  );
}

function modeSwitch(active) {
  const onItem = active === null;
  const pick = (value, label, title) =>
    el('button', {
      class: `mode${mode() === value ? ' mode-on' : ''}`,
      text: label,
      title,
      disabled: !onItem,
      onclick: () => {
        localStorage.setItem(MODE_KEY, value);
        route();
      },
    });
  // The label is inside the switch, not beside it, so that mode-idle dims the
  // two together: off an item page the whole control is out of play.
  return el(
    'div',
    {
      class: `mode-switch${onItem ? '' : ' mode-idle'}`,
      title: onItem ? '' : 'Mobile view applies to an item page',
    },
    el('span', { class: 'muted mode-label', text: 'View mode:' }),
    el('div', { class: 'mode-buttons' }, pick('crm', 'CRM'), pick('mobile', 'Mobile')),
  );
}

// ------------------------------------------------------------------- search

// The query lives in the route — #/<release>/library?q=… — and this field is a
// reflection of it, not a second copy of it: typing rewrites the hash, and the
// All content items tab paints from what the hash says. That is what lets a
// search start on a program or an item page and land on the list.
//
// One node, kept between repaints, because chrome() is rebuilt on every route
// and a field replaced under the cursor loses the word being typed into it.
const searchField = el('input', {
  class: 'search',
  type: 'search',
  placeholder: 'Search all content items',
  title: 'Search every content item, from any page',
  oninput: () => queueSearch(),
  onkeydown: (e) => {
    if (e.key !== 'Escape') return;
    searchField.value = '';
    queueSearch();
  },
});

let searchTimer = null;
// True for exactly the debounce, the one window in which the field is ahead of
// the route rather than behind it. See the repaint in route().
let searchPending = false;

/**
 * Writes the field into the route, a beat after the typing stops.
 *
 * Debounced because a keystroke repaints the whole list. The first keystroke
 * pushes and the rest replace, so Back leaves the search for the page it
 * started from rather than walking back through the word a letter at a time.
 */
function queueSearch() {
  clearTimeout(searchTimer);
  searchPending = true;
  searchTimer = setTimeout(() => {
    searchPending = false;
    if (!state.rel) return;
    const query = searchField.value.trim();
    const target = href(state.rel.id)('library', query ? { q: query } : {});
    if (location.hash === target) return;
    const here = parseHash();
    if (here.rest[0] === 'library' && here.params.get('q')) {
      // Already inside a search: this is the same step of history, refined.
      history.replaceState(null, '', target);
      thread.close();
      route().catch(() => {});
    } else {
      location.hash = target;
    }
  }, 200);
}

function loadingScreen(text, node) {
  return el('div', { class: 'centered' }, el('p', { class: 'lede', text }), node);
}

// ------------------------------------------------------------------ routing

async function route({ keepScroll = false } = {}) {
  if (!state.rel) return;
  const { release, rest, params } = parseHash();

  if (release !== state.rel.id) {
    if (release && data.releases().includes(release)) {
      state.rel = await data.release(release);
    } else {
      location.replace(`#/${state.rel.id}/`);
      return;
    }
  }

  const ctx = { rel: state.rel, href: href(state.rel.id) };
  const [head, arg] = rest;
  let body;
  // null means no tab is the current one — an item or a collection sits under
  // one of them but is not one of them.
  let active = null;
  // The 1180px column is for CRM, where cards are fluid and a line of text
  // stops reading well past it. Mobile View is a grid of fixed 393px phones, and
  // that column fits two of them on any screen — so its page takes the window.
  let wide = false;

  if (!head) {
    active = '';
    body = views.programsView(ctx);
  } else if (head === 'explore') {
    active = 'explore';
    body = views.exploreView(ctx);
  } else if (head === 'library') {
    active = 'library';
    body = views.libraryView(ctx, params.get('q') || '');
  } else if (head === 'c') {
    const collection = data.findCollection(state.rel, decodeURIComponent(arg || ''));
    body = collection
      ? views.collectionView(ctx, collection)
      : el('p', { class: 'note', text: `No collection ${arg} in ${state.rel.id}.` });
  } else if (head === 'i') {
    const id = decodeURIComponent(arg || '');
    const item = await data.item(id);
    const sibs = siblings(params.get('from'), id);
    wide = mode() === 'mobile' && Boolean(item);
    body =
      wide
        ? el(
            'div',
            {},
            views.backLink(ctx, sibs),
            el('header', { class: 'page-head' }, views.itemMeta(ctx, item), el('h1', { text: item.title })),
            mobileItemView(ctx, item, id),
            views.siblingNav(ctx, sibs),
          )
        : views.itemView(ctx, item, id, sibs);
  } else {
    body = el('p', { class: 'note', text: 'Nothing here.' });
  }

  // The field reflects the route, and is only allowed to differ from it for the
  // one debounce in which the letters just typed have not reached the hash yet.
  // Anywhere else the route wins — a Back out of a search has to empty the
  // field, or it would claim a query the list is not filtered by. Assigning
  // only on a difference keeps an identical repaint off the caret.
  const wanted = params.get('q') || '';
  if (!searchPending && searchField.value !== wanted) searchField.value = wanted;
  const typing = document.activeElement === searchField;
  const caret = typing ? [searchField.selectionStart, searchField.selectionEnd] : null;

  const at = window.scrollY;
  show(chrome(active), el('main', { class: `page${wide ? ' page-wide' : ''}` }, body));
  // Moving the field into the new header takes it out of the document, and a
  // detached element is a blurred one. Put the cursor back where it was.
  if (typing) {
    searchField.focus();
    searchField.setSelectionRange(...caret);
  }
  // The panel survives a repaint; the focus classes it puts on the page do not.
  thread.refocus();
  // An upload repaints the page under the designer; putting them back at the
  // top of a nine-screen item would lose the screen they were working on.
  window.scrollTo(0, keepScroll ? at : 0);
}

/** Prev/next inside the collection the item was opened from, if any. */
function siblings(key, id) {
  if (!key) return null;
  const collection = data.findCollection(state.rel, key);
  if (!collection) return null;
  const refs = collection.items.map((i) => i.ref);
  const at = refs.indexOf(id);
  if (at === -1) return null;
  return {
    key,
    title: collection.title || collection.id,
    prev: refs[at - 1] || null,
    next: refs[at + 1] || null,
  };
}

// --------------------------------------------------------------------- boot

async function boot() {
  if (!gh.hasToken()) {
    show(views.authView(onToken));
    return;
  }

  try {
    show(loadingScreen('Reading the file list…'));
    await data.loadTree();

    if (!data.releases().length) {
      show(
        el('div', { class: 'centered' }, el('p', { class: 'error', text: 'No releases/<id>/release.json found in this repository.' })),
      );
      return;
    }

    const wanted = parseHash().release;
    const id = data.releases().includes(wanted) ? wanted : data.releases()[0];
    state.rel = await data.release(id);

    const bar = el('div', { class: 'progress' }, el('div', { class: 'bar', style: 'width:0%' }));
    show(loadingScreen(`Reading ${data.itemIds().length} content items…`, bar));
    await data.loadAllItems((done, total) => {
      bar.firstChild.style.width = `${(done / total) * 100}%`;
    });

    // One more call, and one that is allowed to fail: a token without Issues
    // reads all the content and simply has no notes on it.
    await comments.load();

    if (!location.hash) location.replace(`#/${id}/`);
    await route();
  } catch (e) {
    if (e instanceof gh.GitHubError && e.status === 401) {
      gh.forgetToken();
      show(views.authView(onToken, e.message));
      return;
    }
    show(
      el(
        'div',
        { class: 'centered' },
        el('p', { class: 'error', text: e.message }),
        el('button', { text: 'Try again', onclick: () => boot() }),
        el('button', {
          class: 'ghost',
          text: 'Use a different token',
          onclick: () => {
            gh.forgetToken();
            show(views.authView(onToken));
          },
        }),
      ),
    );
  }
}

async function onToken(value, name, email) {
  gh.setToken(value);
  if (name?.trim() && email?.trim()) who.remember(name, email);
  try {
    await gh.repository();
  } catch (e) {
    gh.forgetToken();
    show(views.authView(onToken, e.message));
    return;
  }
  // A new token may be for a different account; drop anything cached under the old.
  await cache.clear();
  boot();
}

window.addEventListener('hashchange', () => {
  // The panel is anchored to something on the page being left.
  thread.close();
  route().catch((e) => show(el('div', { class: 'centered' }, el('p', { class: 'error', text: e.message }))));
});

// A posted note changes counts on cards the page is already showing. The panel
// lives on <body>, so redrawing under it costs nothing and keeps them true.
window.addEventListener('pawzi:thread', () => {
  route({ keepScroll: true }).catch(() => {});
});

window.addEventListener('pawzi:who', () => {
  route({ keepScroll: true }).catch(() => {});
});

// An upload commits and folds the result into what the app already holds, so
// the new picture only has to be drawn — no tree call, no reload.
window.addEventListener('pawzi:committed', () => {
  route({ keepScroll: true }).catch((e) =>
    show(el('div', { class: 'centered' }, el('p', { class: 'error', text: e.message }))),
  );
});

boot();
