// Mobile View: the same item, drawn inside the app's real screens.
//
// The mockups live in Figma, file rfaH5CCK0bHUgptev18c3c, section "Mockups":
// reader (1:1443), command info (1:1453), training steps (1:1622), article
// info (1:1857). Every size, weight and colour is in app/mobile.css — this file
// only decides which screen a piece of content belongs on.
//
// Three screens per item, matching what the app shows:
//   info    — cover, title, description, and for a command the facts table
//   reader  — one phone per entry in screens[], with the progress bar at it
//   steps   — the 2x2 picture grid and the numbered list, commands only

import { el, imageSlot, coverSlot, screenSlot, stepSlot, screenContext } from './views.js';
import { threadButton } from './thread.js';

// ------------------------------------------------------------------- icons

const svg = (viewBox, paths, attrs = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('fill', attrs.fill || 'currentColor');
  if (attrs.class) node.setAttribute('class', attrs.class);
  // An <svg> with no intrinsic size falls back to 300x150, which blows the
  // status bar apart; the icons that are not sized by CSS carry their own.
  if (attrs.size) {
    node.setAttribute('width', attrs.size[0]);
    node.setAttribute('height', attrs.size[1]);
  }
  node.innerHTML = paths;
  return node;
};

const icon = {
  close: () =>
    svg('0 0 24 24', '<path d="M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4L13.4 12l5.3 5.3-1.4 1.4L12 13.4l-5.3 5.3-1.4-1.4L10.6 12 5.3 6.7z"/>'),
  back: () => svg('0 0 24 24', '<path d="M15.5 4.6 7.1 12l8.4 7.4 1.3-1.5L10 12l6.8-5.9z"/>'),
  chevronDown: () => svg('0 0 24 24', '<path d="M12 15.5 5.5 9l1.4-1.4L12 12.7l5.1-5.1L18.5 9z"/>'),
  check: () => svg('0 0 24 24', '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.3 14.4-4-4 1.5-1.5 2.5 2.6 5.2-5.4 1.5 1.4z"/>'),
  play: () =>
    svg('0 0 24 24', '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 5.6 7 4.4-7 4.4z"/>'),
  paw: (off) =>
    svg(
      '0 0 24 24',
      '<ellipse cx="5.6" cy="9.4" rx="2.6" ry="3.2"/><ellipse cx="10.6" cy="6.2" rx="2.7" ry="3.5"/><ellipse cx="16" cy="6.4" rx="2.7" ry="3.5"/><ellipse cx="20.2" cy="9.8" rx="2.4" ry="3"/><path d="M12.7 12.1c2.9 0 5.5 2.1 6.2 4.7.6 2.3-1 4.3-3.4 4.3-1.2 0-2-.4-2.8-.4s-1.6.4-2.8.4c-2.4 0-4-2-3.4-4.3.7-2.6 3.3-4.7 6.2-4.7z"/>',
      { class: off ? 'off' : '' },
    ),
  dumbbell: () =>
    svg(
      '0 0 24 24',
      '<path d="M3 9h2v6H3zm3-2h2.5v10H6zM9.5 11h5v2h-5zM15.5 7H18v10h-2.5zM19 9h2v6h-2z"/>',
    ),
  clock: () =>
    svg(
      '0 0 24 24',
      '<path d="M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4zm5 4v6.4l4.2 2.5 1-1.7-3.2-1.9V6z"/>',
    ),
  star: () =>
    svg('0 0 24 24', '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.4l6.6-.9z"/>'),
};

function statusBar(onImage) {
  return el(
    'div',
    { class: `mv-status${onImage ? ' on-image' : ''}` },
    el('span', { class: 'time', text: '9:41' }),
    el(
      'span',
      { class: 'levels' },
      svg('0 0 19 12', '<path d="M1 8h2v4H1zM6 5.5h2V12H6zM11 3h2v9h-2zM16 .5h2V12h-2z"/>', { size: [19, 12] }),
      svg(
        '0 0 17 12',
        '<path d="M8.5 11.8 6.2 9.3a3.4 3.4 0 0 1 4.6 0zM3.8 6.8 2.1 5A9.3 9.3 0 0 1 15 5l-1.8 1.8a6.7 6.7 0 0 0-9.4 0z"/>',
        { size: [17, 12] },
      ),
      svg(
        '0 0 27 13',
        '<rect x="0.5" y="0.5" width="24" height="12" rx="4.3" fill="none" stroke="currentColor" opacity="0.35"/><rect x="2" y="2" width="21" height="9" rx="2.5"/><path d="M26 4.3v4.4a2.4 2.4 0 0 0 0-4.4z" opacity="0.4"/>',
        { size: [27, 13] },
      ),
    ),
  );
}

const round = (kind, glyph) => el('div', { class: `mv-round ${kind}` }, glyph);

/** The Learn / Train bar. On a reader screen Learn is the wide lane; on the
 *  steps screen the two swap, Learn shows a tick and Train carries the fill. */
function progress(mode, { total = 0, at = 0 } = {}) {
  const segments = el('div', { class: 'segments' });
  for (let i = 0; i < total; i++) segments.append(el('i', { class: i <= at ? 'on' : '' }));

  const learn =
    mode === 'reader'
      ? el(
          'div',
          { class: 'lane-wide' },
          el('div', { class: 'lane-label' }, 'Learn'),
          segments,
        )
      : el(
          'div',
          { class: 'lane-narrow' },
          el('div', { class: 'lane-label' }, 'Learn', icon.check()),
          el('div', { class: 'bar done' }, el('span', { style: 'width:100%' })),
        );

  const train =
    mode === 'reader'
      ? el(
          'div',
          { class: 'lane-narrow' },
          el('div', { class: 'lane-label off', text: 'Train' }),
          el('div', { class: 'bar' }, el('span', { style: 'width:0' })),
        )
      : el(
          'div',
          { class: 'lane-wide' },
          el('div', { class: 'lane-label', text: 'Train' }),
          el('div', { class: 'bar' }, el('span', { style: 'width:75%' })),
        );

  return el('div', { class: 'mv-progress' }, learn, train);
}

const cta = (label, glyph) => el('div', { class: 'mv-cta' }, label, glyph || null);

// ----------------------------------------------------------------- screens

function readerScreen(item, screen, index) {
  return el(
    'div',
    { class: 'mv-screen mv-reader' },
    statusBar(),
    el(
      'div',
      { class: 'mv-header' },
      el(
        'div',
        { class: 'mv-title-row' },
        round('', icon.close()),
        el('h1', { text: item.title }),
        round('mv-round-ghost', icon.close()),
      ),
      progress('reader', { total: item.screens.length, at: index }),
    ),
    el(
      'div',
      { class: 'mv-content' },
      el('div', { class: 'hero' }, imageSlot('screen', screen.imageId, { ratio: null, slot: screenSlot(item, screen) })),
      el(
        'div',
        { class: 'mv-text' },
        el('h2', { text: screen.title }),
        el('p', { text: screen.body }),
      ),
    ),
    cta('Next'),
  );
}

function articleInfoScreen(item) {
  return el(
    'div',
    { class: 'mv-screen mv-article' },
    el(
      'div',
      { class: 'mv-sheet' },
      el(
        'div',
        { class: 'hero' },
        imageSlot('cover', item.imageId, { ratio: null, label: 'No cover yet', slot: coverSlot(item) }),
        el('div', { class: 'fade' }),
      ),
      el(
        'div',
        { class: 'mv-intro' },
        el('div', { class: 'pill', text: item.title }),
        el('div', { class: 'desc', text: item.contentDescription || '' }),
      ),
    ),
    statusBar(true),
    round('mv-round-scrim', icon.back()),
    cta('Start', icon.play()),
  );
}

function factsTable(item) {
  const paws = el('div', { class: 'mv-paws' });
  // The mockup shows five paws; v1.10 difficulty runs 1-4, so the top of the
  // scale is simply never reached.
  for (let i = 1; i <= 5; i++) paws.append(icon.paw(i > (item.difficulty || 0)));

  const row = (kind, glyph, label, value) =>
    el(
      'div',
      { class: 'row' },
      el('div', { class: 'left' }, el('div', { class: `icon icon-${kind}` }, glyph), el('dt', { text: label })),
      value,
    );

  return el(
    'dl',
    { class: 'mv-table' },
    row('difficulty', icon.dumbbell(), 'Difficulty', paws),
    el('hr', {}),
    row('time', icon.clock(), 'Training time', el('dd', { text: item.trainingTime || '—' })),
    el('hr', {}),
    row('equipment', icon.star(), 'Equipment', el('dd', { text: item.equipment || '—' })),
  );
}

function commandInfoScreen(item) {
  const pawCluster = (position) => {
    const cluster = el('div', { class: `paws ${position}` });
    const marks = [
      [0, 0],
      [52, 39],
      [24, 65],
      [83, 65],
      [61, 123],
      [106, 97],
      [165, 168],
      [157, 218],
    ];
    for (const [x, y] of marks) {
      const mark = icon.paw();
      mark.setAttribute('width', '44');
      mark.setAttribute('height', '44');
      mark.setAttribute('style', `position:absolute;left:${x}px;top:${y}px`);
      cluster.append(mark);
    }
    cluster.setAttribute('style', 'width:250px;height:263px');
    return cluster;
  };

  return el(
    'div',
    { class: 'mv-screen mv-command' },
    pawCluster('tr'),
    pawCluster('bl'),
    statusBar(),
    el(
      'div',
      { class: 'mv-nav' },
      round('mv-round-dark', icon.back()),
      el('div', { class: 'mv-status-pill' }, 'Not started', icon.chevronDown()),
    ),
    el(
      'div',
      { class: 'hero' },
      imageSlot('cover', item.imageId, { ratio: null, label: 'No cover yet', slot: coverSlot(item) }),
    ),
    el(
      'div',
      { class: 'mv-sheet' },
      el(
        'div',
        { class: 'top' },
        el(
          'div',
          { class: 'mv-headings' },
          el('h1', { text: item.title }),
          el('div', { class: 'desc', text: item.contentDescription || '' }),
        ),
        factsTable(item),
      ),
      cta('Start', icon.play()),
    ),
  );
}

function stepsScreen(item) {
  const steps = [...item.steps].sort((a, b) => a.index - b.index);

  const grid = el(
    'div',
    { class: 'mv-grid' },
    steps.map((step) =>
      el(
        'div',
        { class: 'cell' },
        imageSlot('screen', step.imageId, { ratio: null, label: 'No image', slot: stepSlot(item, step) }),
        el('span', { class: 'n', text: String(step.index) }),
      ),
    ),
  );

  return el(
    'div',
    { class: 'mv-screen mv-steps' },
    statusBar(),
    el(
      'div',
      { class: 'mv-header' },
      el(
        'div',
        { class: 'mv-title-row' },
        round('mv-round-quiet', icon.back()),
        el('h1', { text: item.title }),
        round('mv-round-ghost', icon.back()),
      ),
      progress('steps'),
    ),
    grid,
    el(
      'div',
      { class: 'mv-sheet' },
      el(
        'ol',
        {},
        steps.map((step) => el('li', {}, el('b', { text: String(step.index) }), el('span', { text: step.text }))),
      ),
      el(
        'div',
        { class: 'mv-cta-row' },
        cta('Finish training'),
        el(
          'div',
          { class: 'mv-clicker' },
          el('div', { class: 'body' }),
          el('div', { class: 'face' }, 'Clicker', el('div', { class: 'gloss' })),
        ),
      ),
    ),
  );
}

// -------------------------------------------------------------------- view

// The label above a phone is the only chrome the mockup allows: a note button
// inside the frame would be pixels the design does not have.
const slot = (label, id, screen, note) =>
  el(
    'div',
    { class: 'mv-slot' },
    el('div', { class: 'mv-label' }, label, id ? el('code', { text: id }) : null, note || null),
    screen,
  );

export function mobileItemView(ctx, item, id) {
  const phones = el('div', { class: 'mv' });

  phones.append(
    slot(
      item.type === 'command' ? 'Info screen' : 'Article info',
      null,
      item.type === 'command' ? commandInfoScreen(item) : articleInfoScreen(item),
    ),
  );

  const screens = item.screens || [];
  screens.forEach((screen, index) =>
    phones.append(
      slot(
        `${index + 1}/${screens.length}`,
        screen.id,
        readerScreen(item, screen, index),
        threadButton(screenContext(item, screen, index), { compact: true }),
      ),
    ),
  );

  if (item.steps?.length) phones.append(slot('Training steps', null, stepsScreen(item)));

  return phones;
}
