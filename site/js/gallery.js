// ─── Image builders ───────────────────────────────────────────────────────────

// Build a single <img>. `type` is the media folder ('album' | 'series'); `slug`
// is the folder that holds the media; `albumSlug` is the source album the
// "Album" lightbox button jumps to ('' to hide it for that image, e.g. series).
function imgTag(type, slug, i, albumSlug, name, lcp) {
  const base = `${VFE_MEDIA_BASE}/assets/${type}/${slug}`;
  const stem = `${slug}_${String(i).padStart(2, '0')}`;
  const loading  = lcp ? '' : 'loading="lazy"';
  const priority = lcp ? 'fetchpriority="high"' : '';
  // Precomputed aspect ratio (dims.js): lets the grid be laid out before the
  // pixels load, so the appearance animation never reflows. Empty if unknown.
  const r = (typeof VFE_DIMS !== 'undefined' && VFE_DIMS[type] && VFE_DIMS[type][slug] && VFE_DIMS[type][slug][i - 1]);
  const ratio = r ? `data-ratio="${r}"` : '';
  return `<img src="${base}/thumbs/${stem}.avif" data-full="${base}/full/${stem}.avif" data-download="${base}/downloads/${stem}.jpg" data-album-slug="${albumSlug}" ${ratio} alt="${name} — photo ${i}" class="m-p-g__thumbs-img" ${loading} ${priority}>`;
}

// All images of a single album or series (1 → count).
function buildItemImages(item, type, startLcp) {
  const albumSlug = type === 'album' ? item.slug : '';
  const imgs = [];
  for (let i = 1; i <= item.count; i++) {
    imgs.push(imgTag(type, item.slug, i, albumSlug, item.name, startLcp && i === 1));
  }
  return imgs.join('\n');
}

// Resolve a mix `source` to a list of album objects.
function resolveSource(source) {
  if (Array.isArray(source)) {
    return source.map(s => VFE.albums.find(a => a.slug === s)).filter(Boolean);
  }
  if (source === 'archive') return VFE.albums.filter(a => a.era === 'archive');
  if (source === 'current') return VFE.albums.filter(a => !a.era || a.era === 'current');
  return VFE.albums; // 'all'
}

// Build a mix view (album-sourced images, optionally shuffled and capped).
function buildMix(mix) {
  const pool = [];
  resolveSource(mix.source).forEach(album => {
    for (let i = 1; i <= album.count; i++) pool.push({ album, i });
  });

  if (mix.random) {
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
  }

  const sliced = mix.count ? pool.slice(0, mix.count) : pool;
  return sliced
    .map(({ album, i }, idx) => imgTag('album', album.slug, i, album.slug, album.name, idx === 0))
    .join('\n');
}

// Build a collection view: the referenced albums' images, concatenated in order.
function buildCollectionImages(collection) {
  const albums = (collection.albums || [])
    .map(s => VFE.albums.find(a => a.slug === s))
    .filter(Boolean);
  const imgs = [];
  let idx = 0;
  albums.forEach(album => {
    for (let i = 1; i <= album.count; i++) {
      imgs.push(imgTag('album', album.slug, i, album.slug, album.name, idx === 0));
      idx++;
    }
  });
  return imgs.join('\n');
}

// ─── Header info ───────────────────────────────────────────────────────────────

function buildItemInfo(item, type) {
  const label = type === 'series' ? 'Series' : type === 'collection' ? 'Collection' : 'Album';

  let meta = '';
  if (type === 'album') {
    const pub = item.publisher || item.developer;
    const dev = item.developer || item.publisher;
    meta = (!pub && !dev) ? ''
      : (pub !== dev)
        ? `<span><span class="name">Publisher(s)</span>${pub}</span>
           <span><span class="name">Developer(s)</span>${dev}</span>`
        : `<span><span class="name">Publisher(s) / Developer(s)</span>${pub}</span>`;
  } else if (item.description) {
    meta = `<span>${item.description}</span>`;
  }

  return `
    <div class="album-infos">
      <h1><span class="album">${label} /</span> ${item.name}</h1>
      <div class="meta">
        ${meta}
      </div>
    </div>`;
}

// ─── Justified layout ────────────────────────────────────────────────────────

// Aspect ratio of a thumbnail: the precomputed value (dims.js) when available so
// the grid can be built before pixels load, otherwise the natural size once
// loaded. null when neither is known yet (skip it for now).
function ratioOf(img) {
  const r = parseFloat(img.dataset.ratio);
  if (r > 0) return r;
  if (img.naturalWidth > 0) return img.naturalWidth / img.naturalHeight;
  return null;
}

function layoutRow(imgs, rowHeight) {
  imgs.forEach(img => {
    img.style.width  = rowHeight * ratioOf(img) + 'px';
    img.style.height = rowHeight + 'px';
    img.classList.add('layout-completed');
  });
}

function justifyGrid(container) {
  const maxHeight = parseInt(container.dataset.maxHeight || 420);
  const containerWidth = container.clientWidth;
  if (!containerWidth) return; // not laid out yet — a ResizeObserver re-runs us later
  // Lay out every image whose ratio is known (precomputed or loaded), skipping
  // only the failed ones (hidden). With dims.js this includes images not loaded
  // yet, so the whole grid is positioned up-front and never reflows.
  const imgs = Array.from(container.querySelectorAll('img'))
    .filter(img => ratioOf(img) !== null && !img.classList.contains('hide'));
  if (!imgs.length) return;

  let row = [];
  let rowRatioSum = 0;
  let lastRowHeight = maxHeight;

  for (const img of imgs) {
    const ratio = ratioOf(img);
    row.push(img);
    rowRatioSum += ratio;

    const rowHeight = containerWidth / rowRatioSum;
    if (rowHeight <= maxHeight) {
      lastRowHeight = rowHeight;
      layoutRow(row, rowHeight);
      row = [];
      rowRatioSum = 0;
    }
  }

  // last partial row — use same height as previous row so image sizes stay consistent
  if (row.length) layoutRow(row, lastRowHeight);
}

// ─── Controls HTML ────────────────────────────────────────────────────────────

const SVG_CLOSE    = `<svg fill="#FFF" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/><path d="M0 0h24v24H0z" fill="none"/></svg>`;
const SVG_PREV     = `<svg fill="#FFF" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="none"/><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`;
const SVG_NEXT     = `<svg fill="#FFF" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>`;
const SVG_DOWNLOAD = `<svg fill="#FFF" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
const SVG_ALBUM    = `<svg fill="#FFF" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="none"/><path d="M19 19H5V5h7V3H3V21H21V12h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;

function buildControls(showAlbum) {
  const controls = document.createElement('div');
  controls.className = 'm-p-g__controls';
  controls.innerHTML = `
    <div class="m-p-g__controls-actions">
      ${showAlbum ? `<a class="m-p-g__controls-album" href="#"><span class="m-p-g__btn m-p-g__btn--album">${SVG_ALBUM}<span class="m-p-g__btn-label">Album</span></span></a>` : ''}
      <button class="m-p-g__controls-download"><span class="m-p-g__btn">${SVG_DOWNLOAD}</span></button>
      <span class="m-p-g__controls-sep"></span>
      <button class="m-p-g__controls-close"><span class="m-p-g__btn">${SVG_CLOSE}</span></button>
    </div>
    <button class="m-p-g__controls-arrow m-p-g__controls-arrow--prev"><span class="m-p-g__btn">${SVG_PREV}</span></button>
    <button class="m-p-g__controls-arrow m-p-g__controls-arrow--next"><span class="m-p-g__btn">${SVG_NEXT}</span></button>
  `;
  return controls;
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function initLightbox(gallery, showSourceButton) {
  const fullBox  = gallery.querySelector('.m-p-g__fullscreen');
  const controls = buildControls(showSourceButton);
  gallery.appendChild(controls);

  const thumbs   = Array.from(gallery.querySelectorAll('.m-p-g__thumbs-img'))
    .filter(t => !t.dataset.failed);
  const fullImgs = thumbs.map(t => {
    const img = new Image();
    img.dataset.full = t.dataset.full;
    img.dataset.download = t.dataset.download;
    img.dataset.albumSlug = t.dataset.albumSlug;
    img.alt = t.alt;
    img.className = 'm-p-g__fullscreen-img';
    fullBox.appendChild(img);
    return img;
  });

  const closeBtn    = controls.querySelector('.m-p-g__controls-close');
  const downloadBtn = controls.querySelector('.m-p-g__controls-download');
  const albumLink   = controls.querySelector('.m-p-g__controls-album');
  const prevBtn     = controls.querySelector('.m-p-g__controls-arrow--prev');
  const nextBtn     = controls.querySelector('.m-p-g__controls-arrow--next');

  let current = -1;

  function updateNav() {
    prevBtn.style.visibility = current === 0 ? 'hidden' : '';
    nextBtn.style.visibility = current === fullImgs.length - 1 ? 'hidden' : '';
  }

  function updateActions() {
    if (!albumLink) return;
    const slug = fullImgs[current].dataset.albumSlug;
    if (slug) {
      albumLink.href = `/index.html?album=${slug}`;
      albumLink.style.display = '';
    } else {
      albumLink.style.display = 'none';
    }
  }

  function show(index, animate) {
    const outgoing = current >= 0 ? fullImgs[current] : null;
    current = index;
    fullImgs.forEach(img => img.classList.remove('active', 'no-anim'));
    const target = fullImgs[index];
    if (!animate) {
      if (outgoing) outgoing.classList.add('no-anim');
      target.classList.add('no-anim');
      target.offsetHeight;
    }
    target.classList.add('active');
    updateNav();
    updateActions();
  }

  // Load an image's full-screen version if not already done. Since the <img>
  // elements stay in the DOM, the preloaded image stays in memory / cache.
  function preload(index) {
    if (index < 0 || index >= fullImgs.length) return;
    const img = fullImgs[index];
    if (!img.src) img.src = img.dataset.full;
  }

  function open(index, animate = true) {
    fullBox.classList.add('active');
    controls.classList.add('active');
    document.body.style.overflow = 'hidden';

    const target = fullImgs[index];
    if (!target.src) target.src = target.dataset.full;
    if (target.complete) {
      show(index, animate);
    } else {
      target.addEventListener('load', () => show(index, animate), { once: true });
    }

    // Preload neighbors (up to ±2) so next/prev display without latency.
    // Priority order: closest first.
    const PRELOAD_RADIUS = 2;
    for (let d = 1; d <= PRELOAD_RADIUS; d++) {
      preload(index - d);
      preload(index + d);
    }
  }

  function close() {
    fullBox.classList.remove('active');
    controls.classList.remove('active');
    fullImgs.forEach(img => img.classList.remove('active'));
    document.body.style.overflow = '';
    current = -1;
  }

  function next() {
    if (current < fullImgs.length - 1) open(current + 1, false);
  }

  function prev() {
    if (current > 0) open(current - 1, false);
  }

  function download() {
    if (current === -1) return;
    const src = fullImgs[current].dataset.download;
    const filename = src.split('/').pop();
    fetch(src)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  // Roving tabindex — only the active thumb is in the tab order
  thumbs.forEach((t, i) => {
    t.tabIndex = i === 0 ? 0 : -1;

    t.addEventListener('focus', () => {
      thumbs.forEach(th => { th.tabIndex = -1; });
      t.tabIndex = 0;
    });

    t.addEventListener('keydown', e => {
      if (current >= 0) return; // lightbox is open, let its handler take over
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(i);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (i < thumbs.length - 1) thumbs[i + 1].focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (i > 0) thumbs[i - 1].focus();
      }
    });

    t.addEventListener('click', () => open(i));
  });

  closeBtn.addEventListener('click', close);
  downloadBtn.addEventListener('click', download);
  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', prev);

  fullBox.addEventListener('click', e => {
    if (e.target === fullBox) close();
  });

  document.addEventListener('keydown', e => {
    if (current === -1) return;
    if (e.key === 'Escape')     close();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft')  prev();
    if (e.key === 'd' || e.key === 'D') download();
    if (e.key === 'Enter' && albumLink && albumLink.style.display !== 'none') albumLink.click();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Decide what to render from the query string. Returns { html, showInfo,
// showSourceButton, isItemPage } or null if the requested item is missing.
function resolveView(params) {
  const albumSlug = params.get('album');
  if (albumSlug) {
    const album = VFE.albums.find(a => a.slug === albumSlug);
    if (!album) return null;
    return { info: buildItemInfo(album, 'album'), html: buildItemImages(album, 'album', true),
             showSourceButton: false, isItemPage: true };
  }

  const seriesSlug = params.get('series');
  if (seriesSlug) {
    const serie = (VFE.series || []).find(s => s.slug === seriesSlug);
    if (!serie) return null;
    return { info: buildItemInfo(serie, 'series'), html: buildItemImages(serie, 'series', true),
             showSourceButton: false, isItemPage: true };
  }

  const collectionSlug = params.get('collection');
  if (collectionSlug) {
    const collection = (VFE.collections || []).find(c => c.slug === collectionSlug);
    if (!collection) return null;
    return { info: buildItemInfo(collection, 'collection'), html: buildCollectionImages(collection),
             showSourceButton: true, isItemPage: false };
  }

  // Mix (named via ?mix=, or the first starred mix by default).
  const mixes = (VFE.starred && VFE.starred.mixes) || [];
  const mixId = params.get('mix');
  const mix = (mixId && mixes.find(m => m.id === mixId)) || mixes[0];
  if (!mix) return { info: '', html: '', showSourceButton: false, isItemPage: false };
  return { info: '', html: buildMix(mix), showSourceButton: true, isItemPage: false };
}

document.addEventListener('DOMContentLoaded', function () {
  const section   = document.getElementById('core-gallery');
  const mpg       = document.querySelector('.m-p-g');
  const thumbsBox = mpg.querySelector('.m-p-g__thumbs');

  const view = resolveView(new URLSearchParams(location.search));
  if (!view) {
    document.getElementById('loading').classList.add('none');
    section.insertAdjacentHTML('afterbegin', '<div class="album-infos"><h1>Not found</h1></div>');
    return;
  }

  if (view.info) section.insertAdjacentHTML('afterbegin', view.info);
  thumbsBox.innerHTML = view.html;

  const thumbs = Array.from(thumbsBox.querySelectorAll('.m-p-g__thumbs-img'));

  // The grid is laid out from precomputed ratios (dims.js), so it's positioned
  // before any pixel loads. The loading overlay is only lifted once the width is
  // stable AND something is paintable, so the user never sees the layout settle
  // (premature width → final width → scrollbar) — no reflow, no jump on appear.
  const loadingEl = document.getElementById('loading');
  let revealed = false, layoutStable = false, anyLoaded = thumbs.length === 0;

  function reveal() {
    if (revealed) return;
    revealed = true;
    loadingEl.classList.add('none');
    if (view.isItemPage && thumbs[0]) thumbs[0].focus();
  }
  function maybeReveal() { if (layoutStable && anyLoaded) reveal(); }

  let rafPending = false;
  function scheduleLayout() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; justifyGrid(thumbsBox); });
  }

  function markFailed(img) {
    img.classList.add('hide');     // failed media: invisible, dropped from the grid
    img.dataset.failed = '1';
    scheduleLayout();              // only failures reflow (rare); re-justify without it
  }

  thumbs.forEach(img => {
    if (img.complete) {
      if (img.naturalWidth === 0 && !img.dataset.ratio) markFailed(img);
      else if (img.naturalWidth > 0) { img.classList.add('loaded'); anyLoaded = true; }
    } else {
      img.addEventListener('load',  () => { img.classList.add('loaded'); anyLoaded = true; maybeReveal(); });
      img.addEventListener('error', () => markFailed(img));
    }
  });

  initLightbox(mpg, view.showSourceButton);     // built over the non-failed thumbs

  // Re-justify on every real width change — window resizes, the container width
  // settling on a hard reload, and the scrollbar appearing once the grid gives the
  // page its height. The layout is "stable" once the width stops changing briefly;
  // only then (and once an image is ready) do we reveal.
  let lastWidth = -1, stableTimer = null;
  function onWidth() {
    const w = thumbsBox.clientWidth;
    if (w === lastWidth) return;
    lastWidth = w;
    layoutStable = false;
    justifyGrid(thumbsBox);
    clearTimeout(stableTimer);
    stableTimer = setTimeout(() => { layoutStable = true; maybeReveal(); }, 80);
  }
  new ResizeObserver(onWidth).observe(thumbsBox);
  onWidth();                                    // initial layout

  setTimeout(reveal, 1500);                     // safety net: never stay hidden
});
