// Boot, chrome and routing.
//
// Routes carry the release, so a link to a screen is a link to that screen in
// that release: #/v1.10/, #/v1.10/explore, #/v1.10/c/<key>, #/v1.10/i/<id>.

import * as gh from './gh.js';
import * as data from './data.js';
import * as cache from './cache.js';
import * as comments from './comments.js';
import * as thread from './thread.js';
import * as views from './views.js';
import { mobileItemView } from './mobile.js';
import { el } from './views.js';
import { SLUG, REF } from '../config.js';

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
    el('nav', { class: 'tabs' }, tab('Programs', ''), tab('Explore', 'explore'), tab('Library', 'library')),
    el(
      'div',
      { class: 'chrome-right' },
      modeSwitch(active),
      // Notes are an addition, so their absence is said once and quietly
      // rather than by a disabled button on every card explaining itself.
      comments.available()
        ? null
        : el('span', { class: 'muted chip', text: 'notes off', title: comments.reason() }),
      el('span', { class: 'muted repo', text: `${SLUG}@${REF}` }),
      el('button', {
        class: 'ghost',
        text: 'Refresh',
        title: 'Re-read the file list from GitHub',
        onclick: () => boot(),
      }),
      el('button', {
        class: 'ghost',
        text: 'Sign out',
        title: 'Forget the token in this browser',
        onclick: () => {
          gh.forgetToken();
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
  return el(
    'div',
    {
      class: `mode-switch${onItem ? '' : ' mode-idle'}`,
      title: onItem ? '' : 'Mobile view applies to an item page',
    },
    pick('crm', 'CRM'),
    pick('mobile', 'Mobile'),
  );
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

  if (!head) {
    active = '';
    body = views.programsView(ctx);
  } else if (head === 'explore') {
    active = 'explore';
    body = views.exploreView(ctx);
  } else if (head === 'library') {
    active = 'library';
    body = views.libraryView(ctx);
  } else if (head === 'c') {
    const collection = data.findCollection(state.rel, decodeURIComponent(arg || ''));
    body = collection
      ? views.collectionView(ctx, collection)
      : el('p', { class: 'note', text: `No collection ${arg} in ${state.rel.id}.` });
  } else if (head === 'i') {
    const id = decodeURIComponent(arg || '');
    const item = await data.item(id);
    const sibs = siblings(params.get('from'), id);
    body =
      mode() === 'mobile' && item
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

  const at = window.scrollY;
  show(chrome(active), el('main', { class: 'page' }, body));
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

async function onToken(value) {
  gh.setToken(value);
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

// An upload commits and folds the result into what the app already holds, so
// the new picture only has to be drawn — no tree call, no reload.
window.addEventListener('pawzi:committed', () => {
  route({ keepScroll: true }).catch((e) =>
    show(el('div', { class: 'centered' }, el('p', { class: 'error', text: e.message }))),
  );
});

boot();
