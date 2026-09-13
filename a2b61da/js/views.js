// Views. Plain DOM, no framework: the whole app is one screen of state and a
// handful of lists, and a dependency would have to be vendored to survive the
// CSP-free static host anyway.

import * as data from './data.js';
import * as upload from './upload.js';
import * as comments from './comments.js';
import { threadButton, itemNoteBadge } from './thread.js';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const TRACKS = {
  under_6_months: 'Under 6 months',
  '6_12_months': '6–12 months',
  '1_plus_years': '1+ years',
  default: 'Any age',
};

export const trackLabel = (track) => TRACKS[track] || track.replace(/_/g, ' ');

// ------------------------------------------------------------------ images

// Assets are fetched through the API, so an <img src> cannot carry the token.
// They load on approach instead, which keeps a 57-card grid to a few requests.
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      entry.target._load?.();
    }
  },
  { rootMargin: '400px' },
);

/**
 * The one place a picture becomes visible, in all four of its states: drawn,
 * not drawn yet (normal — 267 of 428 screens), named but missing (an error the
 * validator also fails on), and failed to load.
 *
 * `slot` makes the same box take a dropped file — see upload.js. Every state
 * accepts one: a hatched screen is exactly where a picture is wanted, and a red
 * one is where a name is waiting for the file it promised.
 */
export function imageSlot(kind, imageId, { ratio = '4 / 3', label = 'No image yet', soft = false, slot } = {}) {
  // ratio: null lets the caller's CSS size the box — the mockup views place
  // pictures at exact pixel sizes taken from Figma.
  const figure = el('figure', { class: 'shot', style: ratio ? `aspect-ratio: ${ratio}` : null });

  // Writing needs a branch to commit onto; a tag or a bare sha has none.
  const droppable = () => (slot && data.head() ? upload.attach(figure, { ...slot, kind, imageId }) : figure);

  if (!imageId) {
    figure.classList.add('shot-empty');
    figure.append(el('span', { class: 'shot-note', text: label }));
    return droppable();
  }

  const path = data.assetPath(kind, imageId);
  if (!path && soft) {
    // Previews are found by name alone (docs/assets.md), so the name is always
    // there and its absence from disk means "not drawn", not "broken link".
    figure.classList.add('shot-empty');
    figure.append(el('span', { class: 'shot-note', text: label }));
    return droppable();
  }
  if (!path) {
    figure.classList.add('shot-missing');
    figure.append(
      el('span', { class: 'shot-note', text: 'Missing asset' }),
      el('code', { class: 'shot-id', text: imageId }),
    );
    return droppable();
  }

  figure.classList.add('shot-loading');
  figure.append(el('code', { class: 'shot-id', text: imageId }));
  figure._load = async () => {
    try {
      const url = await data.assetUrl(path);
      const img = el('img', { src: url, alt: imageId, loading: 'lazy' });
      img.addEventListener('load', () => figure.classList.remove('shot-loading'));
      figure.prepend(img);
    } catch (e) {
      figure.classList.remove('shot-loading');
      figure.classList.add('shot-missing');
      figure.prepend(el('span', { class: 'shot-note', text: 'Could not load' }));
    }
  };
  observer.observe(figure);
  return droppable();
}

// --------------------------------------------------------------- drop slots
//
// What each kind of picture is and where its name is written. `target` is the
// live object inside the loaded JSON that carries `imageId`; a preview has no
// target because nothing in any JSON names a preview.

export const coverSlot = (item) => ({
  file: `content/${item.id}.json`,
  target: item,
  what: `the cover of ${item.id}`,
});

export const screenSlot = (item, screen) => ({
  file: `content/${item.id}.json`,
  target: screen,
  what: `${item.id} / ${screen.id}`,
});

export const stepSlot = (item, step) => ({
  file: `content/${item.id}.json`,
  target: step,
  what: `${item.id} step ${step.index}`,
});

export const previewSlot = (itemId) => ({ file: null, target: null, what: `the preview of ${itemId}` });

export const cardSlot = (ctx, collection) => ({
  file: `releases/${ctx.rel.id}/${ctx.rel.manifest.explore || 'explore.json'}`,
  target: collection,
  what: `the card picture of ${collection.id}`,
});

// ------------------------------------------------------------- note anchors
//
// What a review note can be attached to, and how the issue it opens describes
// itself. `title` is the issue title — it is what `gh issue list` prints, so it
// is the id and the part, nothing else. `subject` is the sentence under the
// note, which carries the wording as it was when the note was written.

// The item anchor addresses the info screen: cover, title, description, and for
// a command the facts table. That screen is what a note about "the item as a
// whole" was always about, so the anchor stays as it was and only the sentence
// under the note says where the note is written.
export const itemContext = (item) => ({
  anchor: comments.itemAnchor(item.id),
  title: item.id,
  subject: `the info screen of the ${item.type} \`${item.id}\` — “${item.title}”`,
});

export const screenContext = (item, screen, index) => ({
  anchor: comments.screenAnchor(item.id, screen.id),
  title: `${item.id} / ${screen.id}`,
  subject: `screen ${index + 1} of \`${item.id}\`, \`${screen.id}\` — “${screen.title}”`,
});

// The 2x2 grid and the numbered list, as one screen. A note about one step still
// goes on that step, in CRM, where each has a card of its own.
export const stepsContext = (item) => ({
  anchor: comments.stepsAnchor(item.id),
  title: `${item.id} / steps`,
  subject: `the training steps screen of \`${item.id}\``,
});

export const stepContext = (item, step) => ({
  anchor: comments.stepAnchor(item.id, step.index),
  title: `${item.id} / step ${step.index}`,
  subject: `training step ${step.index} of \`${item.id}\``,
});

// ------------------------------------------------------------------- pieces

const typeBadge = (type) => el('span', { class: `badge badge-${type}`, text: type });

function difficultyDots(level) {
  // The scale is five (schema/item.command.json: maximum 5), same as the paws in
  // Mobile View; v1.10 only ever reaches 4, so the fifth dot stays grey.
  const dots = el('span', { class: 'dots', title: `Difficulty ${level} of 5` });
  for (let i = 1; i <= 5; i++) dots.append(el('i', { class: i <= level ? 'on' : '' }));
  return dots;
}

function itemCard(ctx, id, { from } = {}) {
  const item = data.itemSync(id);
  const href = ctx.href(`i/${id}`, from ? { from } : {});

  if (!item) {
    return el(
      'a',
      { class: 'card card-missing', href },
      el('div', { class: 'card-body' }, el('code', { text: id }), el('p', { text: 'Not in content/' })),
    );
  }

  return el(
    'a',
    { class: 'card', href },
    imageSlot('preview', id, { ratio: '1 / 1', label: 'No preview', soft: true, slot: previewSlot(id) }),
    el(
      'div',
      { class: 'card-body' },
      el('h3', { text: item.title }),
      el('p', { class: 'muted', text: item.contentDescription || '' }),
      el(
        'div',
        { class: 'card-meta' },
        typeBadge(item.type),
        item.type === 'command' && item.difficulty ? difficultyDots(item.difficulty) : null,
        el('span', { class: 'muted', text: `${item.screens?.length || 0} screens` }),
        itemNoteBadge(id),
      ),
    ),
  );
}

function collectionCard(ctx, collection) {
  const key = data.collectionKey(collection);
  const isCard = collection.kind === 'troubleshooting-card';
  return el(
    'a',
    { class: 'card', href: ctx.href(`c/${key}`) },
    isCard
      ? imageSlot('card', collection.imageId, { ratio: '4 / 3', label: 'No card image', slot: cardSlot(ctx, collection) })
      : null,
    el(
      'div',
      { class: 'card-body' },
      el('h3', { text: collection.title || collection.id }),
      el('code', { class: 'muted', text: collection.id }),
      el(
        'div',
        { class: 'card-meta' },
        el('span', { class: 'muted', text: `${collection.items.length} items` }),
        collection.items.some((i) => i.optional)
          ? el('span', { class: 'muted', text: 'has optional' })
          : null,
      ),
    ),
  );
}

const section = (title, note, ...children) =>
  el(
    'section',
    { class: 'block' },
    el('h2', {}, title, note ? el('span', { class: 'count', text: note }) : null),
    ...children,
  );

// -------------------------------------------------------------------- views

export function programsView(ctx) {
  const { programs } = ctx.rel;
  const tracks = programs.tracks || [];
  const wrap = el('div', {});

  for (const track of tracks) {
    const collections = programs.collections.filter((c) => c.audience?.dogAge === track);
    if (!collections.length) continue;
    wrap.append(
      section(
        trackLabel(track),
        `${collections.length} programs`,
        el('div', { class: 'grid' }, collections.map((c) => collectionCard(ctx, c))),
      ),
    );
  }

  const untracked = programs.collections.filter((c) => !c.audience?.dogAge);
  if (untracked.length) {
    wrap.append(
      section('No track', null, el('div', { class: 'grid' }, untracked.map((c) => collectionCard(ctx, c)))),
    );
  }
  return wrap;
}

// The order the Library Tab reads in. It lives here and not in
// releases/<id>/explore.json because tools/build-structure.mjs carries section
// order into the key order of content-structure.json, and CI compares that
// against the file shipped in 1.10 key for key — reordering the data would fail
// that round-trip check while changing nothing in Pawzi, whose Library tab
// orders itself in code. When the app's own order has to change, this moves
// into the data and the check is pinned to the release that changed it.
const EXPLORE_ORDER = ['troubleshooting', 'commands', 'articles'];

/** Sections in reading order; anything unlisted keeps its place at the end. */
function exploreSections(sections) {
  const rank = (sec) => {
    const at = EXPLORE_ORDER.indexOf(sec.id);
    return at === -1 ? EXPLORE_ORDER.length : at;
  };
  // Sort is stable, so a section nobody listed here still appears — after the
  // ones that are, in the order the release put them in.
  return [...sections].sort((a, b) => rank(a) - rank(b));
}

export function exploreView(ctx) {
  const wrap = el('div', {});
  for (const sec of exploreSections(ctx.rel.explore.sections || [])) {
    if (sec.collections) {
      wrap.append(
        section(
          sec.title,
          `${sec.collections.length}`,
          el('div', { class: 'grid' }, sec.collections.map((c) => collectionCard(ctx, c))),
        ),
      );
    } else {
      wrap.append(
        section(
          sec.title,
          `${sec.items.length}`,
          el('div', { class: 'grid' }, sec.items.map((i) => itemCard(ctx, i.ref))),
        ),
      );
    }
  }
  return wrap;
}

/**
 * The flat list of everything in `content/`, filtered by the query.
 *
 * The query arrives from the route — `#/<release>/library?q=…` — and the field
 * that writes it lives in the header, so a search can start from any page. This
 * view holds no field of its own: one query, one place it is written down.
 */
export function libraryView(ctx, query = '') {
  const shipped = new Set(ctx.rel.manifest.items || []);
  const ids = data.itemIds().sort();

  const results = el('div', {});

  const unreleased = ids.filter((id) => !shipped.has(id));

  function paint(query) {
    const q = query.trim().toLowerCase();
    const match = (id) => {
      if (!q) return true;
      const item = data.itemSync(id);
      return (
        id.includes(q) ||
        (item?.title || '').toLowerCase().includes(q) ||
        (item?.contentDescription || '').toLowerCase().includes(q)
      );
    };
    const visible = ids.filter(match);
    const groups = [
      ['Articles', visible.filter((id) => data.itemSync(id)?.type === 'article')],
      ['Commands', visible.filter((id) => data.itemSync(id)?.type === 'command')],
      ['Other types', visible.filter((id) => !['article', 'command'].includes(data.itemSync(id)?.type))],
    ];

    results.replaceChildren();
    if (unreleased.length && !q) {
      results.append(
        el(
          'p',
          { class: 'note' },
          `${unreleased.length} items are in content/ but not in ${ctx.rel.id}: `,
          el('code', { text: unreleased.join(', ') }),
        ),
      );
    }
    for (const [title, list] of groups) {
      if (!list.length) continue;
      results.append(
        section(
          title,
          `${list.length}`,
          el(
            'div',
            { class: 'grid' },
            list.map((id) => {
              const card = itemCard(ctx, id);
              if (!shipped.has(id)) {
                card.classList.add('card-unreleased');
                card
                  .querySelector('.card-meta')
                  ?.append(el('span', { class: 'badge badge-draft', text: 'not in release' }));
              }
              return card;
            }),
          ),
        ),
      );
    }
    if (!visible.length) results.append(el('p', { class: 'note', text: 'Nothing matches that.' }));
  }

  paint(query);
  return results;
}

export function collectionView(ctx, collection) {
  const key = data.collectionKey(collection);
  const head = el(
    'header',
    { class: 'page-head' },
    el('a', { class: 'back', href: ctx.href(collection.kind === 'program' ? '' : 'explore'), text: '← Back' }),
    el('h1', { text: collection.title || collection.id }),
    el(
      'div',
      { class: 'page-meta' },
      el('span', { class: 'badge', text: collection.kind }),
      collection.audience?.dogAge
        ? el('span', { class: 'badge badge-track', text: trackLabel(collection.audience.dogAge) })
        : null,
      el('code', { class: 'muted', text: collection.id }),
    ),
  );

  return el(
    'div',
    {},
    head,
    collection.kind === 'troubleshooting-card'
      ? el(
          'div',
          { class: 'card-hero' },
          imageSlot('card', collection.imageId, { ratio: '16 / 9', slot: cardSlot(ctx, collection) }),
        )
      : null,
    el(
      'ol',
      { class: 'ordered-grid' },
      collection.items.map((entry, index) =>
        el(
          'li',
          { class: 'ordered-item' },
          el('span', { class: 'ordinal', text: String(index + 1) }),
          itemCard(ctx, entry.ref, { from: key }),
          entry.optional ? el('span', { class: 'badge', text: 'optional' }) : null,
        ),
      ),
    ),
  );
}

export function itemView(ctx, item, id, siblings) {
  if (!item) {
    return el(
      'div',
      { class: 'page-head' },
      el('a', { class: 'back', href: ctx.href(''), text: '← Back' }),
      el('h1', { text: id }),
      el('p', { class: 'note', text: 'No such file in content/.' }),
    );
  }

  // The head is the info screen in CRM clothing — same cover, title,
  // description and facts — so it carries the info-screen note and answers to
  // the same anchor the Mobile View phone does.
  const info = itemContext(item);
  const head = el(
    'header',
    { class: 'item-head', dataset: { anchor: info.anchor } },
    el(
      'div',
      { class: 'item-cover' },
      el(
        'div',
        { class: 'info-top' },
        el('span', { class: 'phone-index', text: item.type === 'command' ? 'Info screen' : 'Article info' }),
        threadButton(info, { compact: true }),
      ),
      imageSlot('cover', item.imageId, { ratio: '4 / 3', label: 'No cover yet', slot: coverSlot(item) }),
    ),
    el(
      'div',
      { class: 'item-intro' },
      itemMeta(ctx, item),
      el('h1', { text: item.title }),
      el('p', { class: 'lede', text: item.contentDescription || '' }),
      item.type === 'command'
        ? el(
            'dl',
            { class: 'facts' },
            el('div', {}, el('dt', { text: 'Difficulty' }), el('dd', {}, difficultyDots(item.difficulty))),
            el('div', {}, el('dt', { text: 'Equipment' }), el('dd', { text: item.equipment || '—' })),
            el('div', {}, el('dt', { text: 'Training time' }), el('dd', { text: item.trainingTime || '—' })),
          )
        : null,
      el(
        'div',
        { class: 'preview-strip' },
        el('span', { class: 'muted', text: 'Preview' }),
        imageSlot('preview', item.id, { ratio: '1 / 1', label: 'None', soft: true, slot: previewSlot(item.id) }),
      ),
    ),
  );

  const screens = el(
    'div',
    { class: 'screens' },
    (item.screens || []).map((screen, index) => {
      const context = screenContext(item, screen, index);
      return el(
        'article',
        { class: 'phone', dataset: { anchor: context.anchor } },
        el(
          'div',
          { class: 'phone-top' },
          el('span', { class: 'phone-index', text: `${index + 1}/${item.screens.length}` }),
          el('code', { class: 'phone-id', text: screen.id }),
          threadButton(context, { compact: true }),
        ),
        imageSlot('screen', screen.imageId, { ratio: '1 / 1', slot: screenSlot(item, screen) }),
        el(
          'div',
          { class: 'phone-text' },
          el('h3', { text: screen.title }),
          el('p', { text: screen.body }),
        ),
      );
    }),
  );

  const steps = item.steps?.length
    ? section(
        'Steps',
        `${item.steps.length}`,
        el(
          'ol',
          { class: 'steps' },
          [...item.steps]
            .sort((a, b) => a.index - b.index)
            .map((step) => {
              const context = stepContext(item, step);
              return el(
                'li',
                { class: 'step', dataset: { anchor: context.anchor } },
                el('span', { class: 'ordinal', text: String(step.index) }),
                imageSlot('screen', step.imageId, { ratio: '1 / 1', label: 'No image', slot: stepSlot(item, step) }),
                el('p', { text: step.text }),
                threadButton(context, { compact: true }),
              );
            }),
        ),
      )
    : null;

  return el(
    'div',
    {},
    backLink(ctx, siblings),
    // Focus mode hides everything but the screen the open note is about, and
    // the item title lives on the info screen — which is one of the things it
    // hides. This line is that title, and it is shown only then.
    el('div', { class: 'focus-crumb' }, el('code', { text: item.id }), el('span', { text: item.title })),
    head,
    section(`Screens`, `${item.screens?.length || 0}`, screens),
    steps,
    siblingNav(ctx, siblings),
  );
}

/** Where an item page goes back to: the collection it was opened from, else the flat item list. */
export function backLink(ctx, siblings) {
  return el('a', {
    class: 'back',
    href: siblings ? ctx.href(`c/${siblings.key}`) : ctx.href('library'),
    text: siblings ? `← ${siblings.title}` : '← All content items',
  });
}

export function siblingNav(ctx, siblings) {
  if (!siblings) return null;
  const link = (id, before, after) =>
    id
      ? el('a', { href: ctx.href(`i/${id}`, { from: siblings.key }) }, before, data.itemSync(id)?.title || id, after)
      : el('span', {});
  return el('nav', { class: 'sibling-nav' }, link(siblings.prev, '← ', ''), link(siblings.next, '', ' →'));
}

/** The one-line identity of an item: type, release standing, id. */
export function itemMeta(ctx, item) {
  const shipped = (ctx.rel.manifest.items || []).includes(item.id);
  // No note button here: a note is written about a screen, and the screen this
  // line sits above is the info screen, which carries its own button.
  return el(
    'div',
    { class: 'page-meta' },
    typeBadge(item.type),
    shipped ? null : el('span', { class: 'badge badge-draft', text: `not in ${ctx.rel.id}` }),
    el('code', { class: 'muted', text: item.id }),
  );
}

// --------------------------------------------------------------------- auth

export function authView(onSubmit, error) {
  const input = el('input', {
    type: 'password',
    id: 'token',
    placeholder: 'github_pat_…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  // The token is shared, so it says nothing about who is holding it. Asking
  // here costs one field and means the first picture or note already carries a
  // name — see who.js.
  const name = el('input', { type: 'text', id: 'auth-name', placeholder: 'Anna Petrova', autocomplete: 'name' });
  const email = el('input', {
    type: 'email',
    id: 'auth-email',
    placeholder: 'anna@example.com',
    autocomplete: 'email',
    spellcheck: 'false',
  });

  const form = el(
    'form',
    {
      class: 'auth',
      onsubmit: (e) => {
        e.preventDefault();
        if (input.value.trim()) onSubmit(input.value, name.value, email.value);
      },
    },
    el('h1', { text: 'Dog Training Content CRM' }),
    error ? el('p', { class: 'error', text: error }) : null,
    el('label', { for: 'token', text: 'Fine-grained personal access token' }),
    input,
    el('label', { for: 'auth-name', text: 'Your name' }),
    name,
    el('label', { for: 'auth-email', text: 'Your email' }),
    email,
    el('p', {
      class: 'muted auth-why',
      text:
        'Everyone shares one token, so GitHub cannot tell you apart. Your name goes on the pictures you upload and signs the notes you write. You can change it later.',
    }),
    el('button', { type: 'submit', text: 'Open' }),
    // No instructions for making a token: the four that exist are issued by the
    // account that owns the repository and handed out, so nobody reading this
    // screen is the person who makes one. See docs/app.md#who-you-are.
    el('p', { class: 'muted auth-why', text: 'The token stays in this browser (localStorage) and is sent only to api.github.com.' }),
  );
  return form;
}
