// The flat content-structure.json the app reads, built from a release.
//
// The repository stores composition in the generalised form described in
// docs/architecture.md: releases/<id>/programs.json + explore.json. The app
// consumes the flat shape. This is the bridge, and it is shared: the build
// script writes the file with it, the validator checks the committed file
// against it, and the reader rebuilds the file with it when a card picture
// changes, in the same commit as the change.

/** Version ids compared part by part as numbers: v1.10 is newer than v1.9. */
export function compareVersions(a, b) {
  const parts = (v) => v.replace(/^v/, '').split('.').map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return a.localeCompare(b);
}

/** The release content-structure.json is built from. */
export const newestRelease = (ids) => [...ids].sort((a, b) => compareVersions(b, a))[0];

/**
 * Key order is part of the output: it is the order the app file was shipped
 * in, and CI compares the rebuilt v1.10 against that file key for key.
 */
export function buildStructure(programs, explore) {
  const structure = { programs: {}, explore: {} };

  for (const track of programs.tracks) structure.programs[track] = [];
  for (const c of programs.collections) {
    const track = c.audience?.dogAge;
    if (!(track in structure.programs)) {
      throw new Error(`collection ${c.id}: unknown audience.dogAge ${track}`);
    }
    structure.programs[track].push({
      id: c.id,
      title: c.title,
      contentIds: c.items.map((i) => i.ref),
    });
  }

  for (const section of explore.sections) {
    if (section.collections) {
      structure.explore[section.id] = {
        title: section.title,
        cards: section.collections.map((c) => ({
          id: c.id,
          title: c.title,
          imageId: c.imageId,
          contentIds: c.items.map((i) => i.ref),
        })),
      };
    } else {
      structure.explore[section.id] = {
        title: section.title,
        contentIds: section.items.map((i) => i.ref),
      };
    }
  }

  return structure;
}

/** Two spaces and a newline, like every JSON file here. */
export const serializeStructure = (structure) => `${JSON.stringify(structure, null, 2)}\n`;
