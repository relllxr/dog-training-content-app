# Pawzi content reader

The reader for the Pawzi dog training content, served from GitHub Pages:
<https://relllxr.github.io/dog-training-content-app/>

**Nothing here is content.** This repository holds one HTML file, two
stylesheets and a handful of ES modules. Every item, picture and release is
fetched at run time from the private content repository, in the viewer's
browser, with the viewer's own token. That is the whole reason the shell is
public and separate: a Pages site is public on every plan below Enterprise
Cloud, so the repository serving it cannot be the one holding the content.

The modules live under `35214bb/`, named for the build, so a new publish
arrives at a new address instead of waiting out a browser cache. `index.html`
is the one file at a fixed address, and the reader shows the build it is running
in its header. The build before this one is kept beside it, so a page loaded a
moment before a publish goes on working.

**Do not edit here.** The source of truth is `app/` in the content
repository, where the reader is versioned alongside what it reads. This copy is
written by `npm run publish-app` and every commit is overwritten by the next
one. Built from `35214bb`.
