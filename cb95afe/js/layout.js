// Where things live in the repository — the one place that says so.
//
// Everything the iOS app takes is under app_content/. The developer pulls that
// folder at a tag and a script on the app side lays it out, so the names inside
// it are the ones that script already reads: the folder names of the 1.10
// delivery, capitals included. Nothing outside app_content/ goes into the app.
//
// The reader and the tools in tools/ both import this, so a folder cannot be
// renamed for one of them and not the other.

export const APP_CONTENT = 'app_content';

export const LAYOUT = {
  /** `<id>.json`, flat — the file name is the id. */
  items: 'app_content/jsons',
  /** Built from the newest release by tools/build-structure.mjs, committed. */
  structure: 'app_content/content-structure.json',
  /** By the kind of slot a picture fills. See docs/assets.md. */
  images: {
    cover: 'app_content/Images/infoscreen',
    screen: 'app_content/Images/Content',
    preview: 'app_content/Images/Previews',
    card: 'app_content/Images/troubleshooting',
  },
  /** Composition. Not pulled by the app: content-structure.json is built from it. */
  releases: 'releases',
};
