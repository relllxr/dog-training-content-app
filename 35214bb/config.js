// Which repository the reader talks to.
//
// Defaults to the content repository; `?repo=owner/name` and `?ref=branch`
// override it, which is what makes the same deployed shell usable against a
// fork or a branch under review without a rebuild.

const params = new URLSearchParams(location.search);

export const SLUG = params.get('repo') || 'relllxr/dog-training-content-repo';
const [owner, repo] = SLUG.split('/');

export const REPO = { owner, repo };
export const REF = params.get('ref') || 'main';

// The token is per repository: a fine-grained token is scoped to one repo, so
// pointing the reader at another one has to ask for its own.
export const TOKEN_KEY = `pawzi.token.${SLUG}`;

// Which build of the shell this is. `tools/publish-app.mjs` publishes the
// modules in a directory named for the build, so the version is simply the
// directory this file sits in; served from `app/` it is the working copy. The
// header says it out loud, because "am I looking at the old version?" is
// otherwise answered by guessing.
const dir = new URL('.', import.meta.url).pathname.replace(/\/$/, '').split('/').pop();
export const BUILD = /^[0-9a-f]{7,40}(-[0-9a-f]{7,40})?$/.test(dir) ? dir : 'dev';
