// Dropping a picture onto a screen.
//
// The designer drags a PNG onto any picture slot in the reader, names it, and
// the app writes the two densities and sets the `imageId` that points at them —
// in one commit (see write.js). That closes the loop the old flow left open:
// the name is invented at the moment the file exists, so it can never be a
// note-to-self that nothing on disk answers (docs/assets.md).
//
// Every slot in the reader is droppable, in both CRM and Mobile views. The
// dialog is the gate: nothing reaches GitHub until it has been read and
// confirmed.

import { el } from './views.js';
import * as data from './data.js';
import * as gh from './gh.js';
import * as who from './who.js';
import * as write from './write.js';
import { prepare, SHIPPED_3X_WIDTH, POINT_WIDTH } from './resize.js';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KIND_LABEL = {
  cover: 'cover',
  screen: 'picture',
  preview: 'preview',
  card: 'card picture',
};

/** The designer's export name is the best guess at the asset name. */
function suggest(filename) {
  return filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/@[23]x$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString()} KB`;

// ------------------------------------------------------------- drop targets

/**
 * Makes one picture slot take a file. `slot` says what the picture is and where
 * its name gets written:
 *
 *   { kind, imageId, file, target, what, subject }
 *
 * `file` and `target` are the JSON to patch and the object inside it that
 * carries `imageId`; a preview has neither, because nothing names a preview.
 */
export function attach(figure, slot) {
  figure.classList.add('shot-drop');

  const pick = el('button', {
    type: 'button',
    class: 'shot-add',
    title: `Upload the ${KIND_LABEL[slot.kind]}`,
    text: '+',
    onclick: (e) => {
      // The slot often sits inside a card that is a link.
      e.preventDefault();
      e.stopPropagation();
      const input = el('input', { type: 'file', accept: 'image/*' });
      input.addEventListener('change', () => {
        if (input.files[0]) open(slot, input.files[0]);
      });
      input.click();
    },
  });
  figure.append(pick);

  let depth = 0; // dragenter fires again for every child under the pointer
  const carriesFile = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  figure.addEventListener('dragenter', (e) => {
    if (!carriesFile(e)) return;
    e.preventDefault();
    if (depth++ === 0) figure.classList.add('shot-over');
  });
  figure.addEventListener('dragover', (e) => {
    if (!carriesFile(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  figure.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      figure.classList.remove('shot-over');
    }
  });
  figure.addEventListener('drop', (e) => {
    if (!carriesFile(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    figure.classList.remove('shot-over');
    const file = e.dataTransfer.files[0];
    if (file) open(slot, file);
  });

  return figure;
}

// -------------------------------------------------------------------- dialog

async function open(slot, file) {
  // The commit will be signed, so the name is asked for before the picture is
  // read rather than at the end, where it would interrupt a finished decision.
  if (!(await who.ensure())) return;

  const panel = el('div', { class: 'dlg-body' }, el('p', { class: 'muted', text: `Reading ${file.name}…` }));
  const dialog = el(
    'dialog',
    { class: 'dlg', onclose: () => dialog.remove() },
    el(
      'form',
      { method: 'dialog', class: 'dlg-form', onsubmit: (e) => e.preventDefault() },
      el('h2', { text: `Upload the ${KIND_LABEL[slot.kind]}` }),
      el('p', { class: 'dlg-what muted', text: slot.what }),
      panel,
    ),
  );
  document.body.append(dialog);
  dialog.showModal();

  let picture;
  try {
    picture = await prepare(file, slot.kind);
  } catch (e) {
    panel.replaceChildren(
      el('p', { class: 'error', text: e.message }),
      el('div', { class: 'dlg-actions' }, el('button', { text: 'Close', onclick: () => dialog.close() })),
    );
    return;
  }

  fill(dialog, panel, slot, picture);
}

function fill(dialog, panel, slot, picture) {
  const fixed = slot.kind === 'preview'; // a preview's name is its item's id

  // The name the dropped file carries wins over the one already in the JSON.
  // Dropping a file onto a slot that has a picture is most often a correction —
  // the slot points at the wrong asset, or the asset is misnamed — and offering
  // the name being corrected made the fix a retype. The id in place is said
  // under the field instead, so renaming is a decision and not an accident, in
  // either direction.
  const dropped = suggest(picture.source.name);
  const nameField = el('input', {
    type: 'text',
    id: 'asset-name',
    value: fixed ? slot.imageId : dropped || slot.imageId || '',
    spellcheck: 'false',
    autocapitalize: 'off',
    disabled: fixed,
    oninput: () => paint(),
    onkeydown: (e) => {
      if (e.key === 'Enter' && !commit.disabled) go();
    },
  });

  const url = URL.createObjectURL(new Blob([picture.two.bytes], { type: 'image/png' }));
  dialog.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });

  // Only worth saying when it is not what the field already holds.
  const current =
    !fixed && slot.imageId && slot.imageId !== nameField.value
      ? el('p', { class: 'muted dlg-current' }, 'now: ', el('code', { text: slot.imageId }))
      : null;

  const notes = el('div', { class: 'dlg-notes' });
  const plan = el('ul', { class: 'dlg-plan' });
  const problem = el('p', { class: 'error' });
  const commit = el('button', { type: 'button', class: 'primary', text: 'Commit', onclick: () => go() });

  // Shown on one failure only: GitHub declining to fast-forward the branch,
  // which means nothing was written and the branch moved between the head
  // check and the move. Everything the commit needs is still in memory —
  // `picture.two` and `picture.three` are the scaled bytes — so a retry is a
  // head read and the same five calls. Making the designer close this, find the
  // file and drag it again was the expensive part of the bug, more expensive
  // than the error itself.
  const retry = el('button', {
    type: 'button',
    class: 'ghost',
    text: 'Refresh and retry',
    hidden: true,
    onclick: async () => {
      retry.hidden = true;
      commit.disabled = true;
      commit.textContent = 'Committing…';
      problem.textContent = '';
      await data.refreshHead();
      go();
    },
  });

  const source = picture.source;
  const shrunk = source.width > picture.three.width;

  panel.replaceChildren(
    el(
      'div',
      { class: 'dlg-grid' },
      el('img', { class: 'dlg-shot', src: url, alt: '' }),
      el(
        'div',
        { class: 'dlg-fields' },
        el('label', { for: 'asset-name', text: fixed ? 'Name (fixed by convention)' : 'Asset name' }),
        nameField,
        current,
        notes,
      ),
    ),
    plan,
    problem,
    el(
      'div',
      { class: 'dlg-actions' },
      el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => dialog.close() }),
      retry,
      commit,
    ),
  );

  function name() {
    return fixed ? slot.imageId : nameField.value.trim();
  }

  function paint() {
    const value = name();
    const valid = NAME.test(value);
    commit.disabled = !valid;
    problem.textContent = value && !valid ? 'Lowercase words joined by single hyphens: boy-luring-stand.' : '';

    const stem = valid ? data.assetStem(slot.kind, value) : '…';
    plan.replaceChildren(
      el('li', {}, el('code', { text: `${stem}@2x.png` }), ` ${picture.two.width}×${picture.two.height}, ${kb(picture.two.bytes.byteLength)}`),
      el('li', {}, el('code', { text: `${stem}@3x.png` }), ` ${picture.three.width}×${picture.three.height}, ${kb(picture.three.bytes.byteLength)}`),
      slot.file && value !== slot.imageId
        ? el('li', {}, el('code', { text: slot.file }), ' — ', el('code', { text: `"imageId": "${value}"` }))
        : null,
    );

    const said = [];
    if (source.type && source.type !== 'image/png') {
      said.push(`${source.name} is ${source.type}; it is committed as PNG.`);
    }
    if (shrunk) {
      said.push(
        `${source.width}×${source.height} scaled down to ${POINT_WIDTH[slot.kind]}pt — the size this slot is drawn at.`,
      );
    } else if (picture.three.width < SHIPPED_3X_WIDTH[slot.kind]) {
      said.push(
        `Narrower than the ${SHIPPED_3X_WIDTH[slot.kind]}px v1.10 uses here; it is committed as it came, not stretched.`,
      );
    }
    if (valid && data.assetPath(slot.kind, value)) {
      const uses = slot.kind === 'preview' || slot.kind === 'card' ? [] : data.usesOfImageId(value);
      said.push(
        `That name exists — both files are replaced${uses.length ? `, and it is on ${uses.join(', ')}` : ''}.`,
      );
    }
    notes.replaceChildren(...said.map((text) => el('p', { class: 'muted', text })));
  }

  async function go() {
    const value = name();
    const replacing = !!data.assetPath(slot.kind, value);
    commit.disabled = true;
    commit.textContent = 'Committing…';
    problem.textContent = '';

    const stem = data.assetStem(slot.kind, value);
    const files = [
      { path: `${stem}@2x.png`, bytes: picture.two.bytes },
      { path: `${stem}@3x.png`, bytes: picture.three.bytes },
    ];

    // The JSON is patched in place so the page can show the result without
    // another round trip; if the commit fails it goes back exactly as it was.
    let doc;
    let before;
    if (slot.file && value !== slot.imageId) {
      doc = await data.json(slot.file);
      before = write.setImageId(slot.target, value);
      const text = write.serialize(doc);
      files.push({ path: slot.file, text, json: doc, bytes: new TextEncoder().encode(text).buffer });
    }

    try {
      const { sha, entries } = await write.commitFiles(message(slot, value, picture, replacing), files);
      data.applyCommit(sha, entries);
      dialog.close();
      window.dispatchEvent(new CustomEvent('pawzi:committed', { detail: { sha } }));
    } catch (e) {
      if (before) write.restore(slot.target, before);
      problem.textContent =
        e instanceof gh.GitHubError || e instanceof write.StaleError ? e.message : `Could not commit: ${e.message}`;
      retry.hidden = !e.notFastForward;
      commit.textContent = 'Commit';
      commit.disabled = false;
    }
  }

  paint();
  if (!fixed) {
    nameField.focus();
    nameField.select();
  }
}

/** What the commit says. Subject in the imperative, provenance in the body. */
function message(slot, value, picture, replacing) {
  // A preview's name never changes, so what makes it a redraw is the file
  // already being there, not the name being the same — and naming it in the
  // subject would only repeat the item id.
  const named = slot.kind === 'preview' ? '' : ` as ${value}`;
  // Named on both, so `git log --oneline` says which asset a redraw touched.
  const subject = `${replacing ? 'Redraw' : 'Draw'} ${slot.what}${named}`;
  return (
    `${subject}\n\n` +
    `${picture.three.width}×${picture.three.height} at @3x and ${picture.two.width}×${picture.two.height} at @2x, ` +
    `from ${picture.source.name} (${picture.source.width}×${picture.source.height}).\n` +
    `Uploaded through the reader.\n`
  );
}
