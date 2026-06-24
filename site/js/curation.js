// Hand-curated, high-level data. The sync script NEVER touches this file.
//
// Augments the VFE object defined in data.js:
//   - VFE.collections : pure groupings of existing albums (no media of their own).
//   - VFE.starred     : the "Starred" section of the Explore overlay — a menu of
//                       mixes followed by pinned items. No `pinned` flag lives on
//                       individual albums/series/collections; it's all driven here.

// Featured images: per-album, the 1-based indices that get the "spotlight"
// treatment in the gallery. Album slugs only — the tag follows the image to
// every view it appears in (album, mix, collection) and is carried onto the
// fullscreen <img> too. See imgTag() in gallery.js. The visual effect is being
// reworked; for now the tag only marks images (.is-featured / data-featured).
VFE.featured = {
  // haloInfinite: [7, 12],   // 1-based indices into the album's media
};

VFE.collections = [
  // {
  //   slug: 'open-worlds',
  //   name: 'Open Worlds',
  //   description: '…',
  //   albums: ['haloInfinite', 'cyberpunk2077']   // album slugs only
  // },
];

VFE.starred = {
  // Saved/named views. `source` is one of:
  //   'all' | 'current' | 'archive' | ['slugA', 'slugB', …] (custom album set)
  // `random` shuffles the pool; `count` caps it (omit for no cap).
  mixes: [
    { id: 'random',  name: 'Random Mix', random: true,  count: 200, source: 'all' },
    { id: 'all',     name: 'All',           random: false,             source: 'all' },
    { id: 'current', name: 'All Current',   random: false,             source: 'current' },
    { id: 'archive', name: 'All Archive',   random: false,             source: 'archive' },
  ],

  // Pinned items, shown after the mixes, in order.
  pinned: [
    // { type: 'album',      slug: 'haloInfinite' },
    // { type: 'collection', slug: 'open-worlds' },
    // { type: 'series',     slug: 'golden-hour' },
  ],
};
