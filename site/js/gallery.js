function buildSetImages(album, setIndex, isFirst) {
  const set = album.images.sets[setIndex];
  const dir = set.dir || (setIndex + 1);
  const setFolder = `set-${dir}`;
  const base = `${VFE_MEDIA_BASE}/assets/album-live/${album.slug}/${setFolder}`;
  const setPrefix = `${album.slug}_set${dir}`;
  const imgs = [];

  const count = album.images.sets[setIndex].count;
  for (let i = 1; i <= count; i++) {
    const stem = `${setPrefix}_${String(i).padStart(2, '0')}`;
    const lcp = isFirst && i === 1;
    const loading = lcp ? '' : 'loading="lazy"';
    const priority = lcp ? 'fetchpriority="high"' : '';
    imgs.push(`<img src="${base}/thumbs/${stem}.webp" data-full="${base}/full/${stem}.webp" data-download="${base}/downloads/${stem}.jpg" data-album-slug="${album.slug}" alt="${album.name} — photo ${i}" class="m-p-g__thumbs-img" ${loading} ${priority}>`);
  }
  return imgs.join('\n');
}

function buildImages(album, albumIndex) {
  return album.images.sets.map((_, i) => buildSetImages(album, i, albumIndex === 0 && i === 0)).join('\n');
}

function buildAlbumInfo(album) {
  const pub = album.publisher || album.developer;
  const dev = album.developer || album.publisher;
  const credit = (!pub && !dev) ? ''
    : (pub !== dev)
      ? `<span><span class="name">Publisher(s)</span>${pub}</span>
         <span><span class="name">Developer(s)</span>${dev}</span>`
      : `<span><span class="name">Publisher(s) / Developer(s)</span>${pub}</span>`;

  return `
    <div class="album-infos">
      <h1><span class="album">Album /</span> ${album.name}</h1>
      <div class="meta">
        ${credit}
      </div>
    </div>`;
}

// ─── Justified layout ────────────────────────────────────────────────────────

function layoutRow(imgs, rowHeight) {
  imgs.forEach(img => {
    const ratio = img.naturalWidth / img.naturalHeight;
    img.style.width  = rowHeight * ratio + 'px';
    img.style.height = rowHeight + 'px';
    img.classList.add('layout-completed');
  });
}

function justifyGrid(container) {
  const maxHeight = parseInt(container.dataset.maxHeight || 420);
  const containerWidth = container.clientWidth;
  const imgs = Array.from(container.querySelectorAll('img'));
  if (!imgs.length) return;

  let row = [];
  let rowRatioSum = 0;
  let lastRowHeight = maxHeight;

  for (const img of imgs) {
    const ratio = img.naturalWidth / img.naturalHeight;
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

// ─── Random Mix ──────────────────────────────────────────────────────────────

function buildRandomMix(albums, count = 100) {
  const pool = [];
  albums.forEach(album => {
    album.images.sets.forEach((set, setIndex) => {
      for (let i = 1; i <= set.count; i++) {
        pool.push({ album, setIndex, imgIndex: i });
      }
    });
  });

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count).map(({ album, setIndex, imgIndex }, i) => {
    const set = album.images.sets[setIndex];
    const dir = set.dir || (setIndex + 1);
    const setFolder = `set-${dir}`;
    const base = `${VFE_MEDIA_BASE}/assets/album-live/${album.slug}/${setFolder}`;
    const setPrefix = `${album.slug}_set${dir}`;
    const stem = `${setPrefix}_${String(imgIndex).padStart(2, '0')}`;
    const lcp = i === 0;
    const loading = lcp ? '' : 'loading="lazy"';
    const priority = lcp ? 'fetchpriority="high"' : '';
    return `<img src="${base}/thumbs/${stem}.webp" data-full="${base}/full/${stem}.webp" data-download="${base}/downloads/${stem}.jpg" data-album-slug="${album.slug}" alt="${album.name} — photo ${imgIndex}" class="m-p-g__thumbs-img" ${loading} ${priority}>`;
  }).join('\n');
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

function initLightbox(gallery, isAlbumPage) {
  const fullBox  = gallery.querySelector('.m-p-g__fullscreen');
  const controls = buildControls(!isAlbumPage);
  gallery.appendChild(controls);

  const thumbs   = Array.from(gallery.querySelectorAll('.m-p-g__thumbs-img'));
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
    if (albumLink) {
      albumLink.href = `/albums/${fullImgs[current].dataset.albumSlug}.html`;
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
    if (e.key === 'Enter' && albumLink)  albumLink.click();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  const section   = document.getElementById('core-gallery');
  const albumSlug = section.dataset.album;
  const mpg       = document.querySelector('.m-p-g');
  const singleThumbsBox = mpg.querySelector('.m-p-g__thumbs');

  if (albumSlug) {
    const album = VFE.albums.find(a => a.slug === albumSlug);
    section.insertAdjacentHTML('afterbegin', buildAlbumInfo(album));

    if (album.images.sets.length > 1) {
      mpg.classList.add('m-p-g--multi');

      // Build set-nav
      const nav = document.createElement('nav');
      nav.className = 'set-nav';
      nav.style.gridRow = `1 / span ${album.images.sets.length}`;

      const navItems = album.images.sets.map((set, i) => {
        const a = document.createElement('a');
        a.className = 'set-nav__item' + (i === 0 ? ' active' : '');
        a.textContent = set.title;
        a.addEventListener('click', e => {
          e.preventDefault();
          document.getElementById(`set-${i}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        nav.appendChild(a);
        return a;
      });

      // Active state on scroll
      const setBlocks = [];
      const frag = document.createDocumentFragment();
      album.images.sets.forEach((set, i) => {
        const block = document.createElement('div');
        block.className = 'set-block';
        block.id = `set-${i}`;
        const thumbsDiv = document.createElement('div');
        thumbsDiv.className = 'm-p-g__thumbs';
        thumbsDiv.dataset.maxHeight = '420';
        thumbsDiv.innerHTML = buildSetImages(album, i, i === 0);
        block.appendChild(thumbsDiv);
        frag.appendChild(block);
        setBlocks.push(block);
      });

      mpg.prepend(nav);
      singleThumbsBox.replaceWith(frag);

      function updateActive() {
        const threshold = window.innerHeight * 0.4;
        let activeIndex = 0;
        setBlocks.forEach((block, i) => {
          if (block.getBoundingClientRect().top < threshold) activeIndex = i;
        });
        navItems.forEach((item, i) => item.classList.toggle('active', i === activeIndex));
      }
      window.addEventListener('scroll', updateActive, { passive: true });
      updateActive();
    } else {
      singleThumbsBox.innerHTML = buildSetImages(album, 0, true);
    }
  } else {
    const era = new URLSearchParams(location.search).get('era');

    if (era === 'current' || era === 'archive') {
      const filtered = VFE.albums.filter(a =>
        era === 'archive' ? a.era === 'archive' : (!a.era || a.era === 'current')
      );
      singleThumbsBox.innerHTML = filtered.map((album, i) => buildImages(album, i)).join('\n');
    } else {
      singleThumbsBox.innerHTML = buildRandomMix(VFE.albums, 100);
    }
  }

  const allThumbsBoxes = Array.from(mpg.querySelectorAll('.m-p-g__thumbs'));
  const allImgs        = Array.from(mpg.querySelectorAll('.m-p-g__thumbs-img'));
  let loaded = 0;

  function onLoad() {
    loaded++;
    if (loaded === allImgs.length) {
      allThumbsBoxes.forEach(justifyGrid);
      initLightbox(mpg, !!albumSlug);
      document.getElementById('loading').classList.add('none');
      if (albumSlug && allImgs[0]) allImgs[0].focus();
    }
  }

  allImgs.forEach(img => {
    if (img.complete) { onLoad(); }
    else { img.addEventListener('load', onLoad); img.addEventListener('error', onLoad); }
  });

  window.addEventListener('resize', () => {
    allImgs.forEach(img => img.classList.remove('layout-completed'));
    allThumbsBoxes.forEach(justifyGrid);
  });
});
