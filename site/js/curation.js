// Hand-curated, high-level data. The sync script NEVER touches this file.
//
// Augments the VFE object defined in data.js:
//   - VFE.collections : pure groupings of existing albums (no media of their own).
//   - VFE.starred     : the "Starred" section of the Explore overlay — a menu of
//                       mixes followed by pinned items. No `pinned` flag lives on
//                       individual albums/series/collections; it's all driven here.
//
// Everything here references slugs (stable); index-coupled data lives in data.js.
// Featured images moved there too (album.featured), so the script can keep their
// indices aligned when media is renumbered.

VFE.collections = [
  {
     slug: 'squareWindow',
     name: 'Window',
     era: 'archive',
     description: '…',
     albums: ['cloudClimber', 'assassinsCreedOrigins_square', 'itTakesTwo', 'celeste', 'haloInfinite', 'carto', 'gris_square']
  },
  // {
  //   slug: 'open-worlds',
  //   name: 'Open Worlds',
  //   era: 'current',                              // 'current' | 'archive' (defaults to current)
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
