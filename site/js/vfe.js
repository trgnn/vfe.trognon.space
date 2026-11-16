// Loads the site's data (data/vfe.json, written by the back-office: npm run admin).
// header.js and gallery.js wait on VFE_READY; window.VFE is set once it resolves.
const VFE_READY = fetch('/data/vfe.json')
  .then(r => { if (!r.ok) throw new Error(`data/vfe.json: ${r.status}`); return r.json(); })
  .then(data => (window.VFE = data));

// Number of images of an album or series.
const vfeCount = item => (item && item.images ? item.images.length : 0);
