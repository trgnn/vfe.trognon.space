// Hand-curated, high-level data. The sync script NEVER touches this file.
//
// Augments the VFE object defined in data.js:
//   - VFE.collections : pure groupings of existing albums (no media of their own).
//   - VFE.starred     : the "Starred" section of the Explore overlay — a menu of
//                       mixes followed by pinned items. No `pinned` flag lives on
//                       individual albums/series/collections; it's all driven here.

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
