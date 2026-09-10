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
