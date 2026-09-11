// Who is writing.
//
// Every token in this setup belongs to the same account, so GitHub sees one
// person: an issue opened through the reader is authored by the account that
// owns the token, whoever actually typed it. That is fine for reading and
// useless for reviewing — a thread where everyone is the same name is not a
// conversation.
//
// So the reader asks once, keeps the answer next to the token, and puts it
// where it survives:
//
//   pictures — `author` on the commit. The Git Data API takes name and email,
//              and with no `committer` alongside it takes those for both, so
//              `git log` shows the person who dropped the file.
//   notes    — a signature on the body, which the panel reads back and shows
//              instead of the account name.
//
// It is a claim, not an identity: anyone with the token can type any name. It
// is worth having anyway, because the alternative is a repository where every
// change was made by one person, and nobody can tell what happened. Real
// identity needs a real account each — see docs/app.md#who-you-are.

import { el } from './views.js';

const KEY = 'pawzi.who';

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw?.name && raw?.email ? raw : null;
  } catch {
    return null;
  }
}

let who = read();

/** `{ name, email }`, or null if nobody has said yet. */
export const me = () => who;
export const known = () => who !== null;

export function remember(name, email) {
  who = { name: name.trim(), email: email.trim() };
  localStorage.setItem(KEY, JSON.stringify(who));
  window.dispatchEvent(new CustomEvent('pawzi:who'));
  return who;
}

export function forget() {
  who = null;
  localStorage.removeItem(KEY);
}

// An email that git will accept and that means something to a human reading
// `git log`. A GitHub address links the commit to that account's profile.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The identity, asking for it first if it is not known yet. Resolves to null
 * if the person cancels, which is the signal to abandon whatever wanted it.
 */
export function ensure() {
  return who ? Promise.resolve(who) : edit();
}

/** The dialog. Resolves to the identity, or null if it was dismissed. */
export function edit() {
  return new Promise((resolve) => {
    let saved = null;

    const name = el('input', {
      type: 'text',
      id: 'who-name',
      value: who?.name || '',
      placeholder: 'Anna Petrova',
      autocomplete: 'name',
      oninput: () => paint(),
    });
    const email = el('input', {
      type: 'email',
      id: 'who-email',
      value: who?.email || '',
      placeholder: 'anna@example.com',
      autocomplete: 'email',
      spellcheck: 'false',
      oninput: () => paint(),
    });

    const problem = el('p', { class: 'error' });
    const save = el('button', {
      type: 'button',
      class: 'primary',
      text: 'Save',
      onclick: () => {
        saved = remember(name.value, email.value);
        dialog.close();
      },
    });

    const dialog = el(
      'dialog',
      {
        class: 'dlg dlg-who',
        onclose: () => {
          dialog.remove();
          resolve(saved);
        },
      },
      el(
        'form',
        { method: 'dialog', class: 'dlg-form', onsubmit: (e) => e.preventDefault() },
        el('h2', { text: 'Who is writing?' }),
        el('p', {
          class: 'dlg-what muted',
          text:
            'The token is shared, so GitHub cannot tell you apart. This name goes on the pictures you upload and signs the notes you write.',
        }),
        el(
          'div',
          { class: 'dlg-body' },
          el('div', { class: 'dlg-fields' }, el('label', { for: 'who-name', text: 'Name' }), name),
          el(
            'div',
            { class: 'dlg-fields' },
            el('label', { for: 'who-email', text: 'Email' }),
            email,
            el('p', {
              class: 'muted',
              text: 'Git needs an address to attribute a commit. Use your GitHub one and the commit links to your profile.',
            }),
          ),
          problem,
          el(
            'div',
            { class: 'dlg-actions' },
            el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => dialog.close() }),
            save,
          ),
        ),
      ),
    );

    function paint() {
      const ok = name.value.trim().length > 1 && EMAIL.test(email.value.trim());
      save.disabled = !ok;
      problem.textContent = email.value.trim() && !EMAIL.test(email.value.trim()) ? 'That does not look like an email address.' : '';
    }

    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') email.focus();
    });
    email.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !save.disabled) save.click();
    });

    document.body.append(dialog);
    paint();
    dialog.showModal();
    (who ? email : name).focus();
  });
}

// ---------------------------------------------------------------- signatures
//
// A note carries its writer as a prefix on the first line. The panel reads it
// back off, so the thread shows the person rather than the account, and a
// reader on GitHub sees the name without knowing anything about this app.

const SIGNED = /^\*\*([^*\n]{1,60})\*\* — /;

export const sign = (text) => (who ? `**${who.name}** — ${text.trim()}` : text.trim());

/** Splits a body into who wrote it and what they said, if it was signed here. */
export function unsign(body) {
  const match = body.match(SIGNED);
  return match ? { name: match[1], text: body.slice(match[0].length) } : { name: null, text: body };
}
