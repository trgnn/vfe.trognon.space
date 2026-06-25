function buildNav(VFE) {
  const albums      = VFE.albums || [];
  const series      = VFE.series || [];
  const collections = VFE.collections || [];
  const starred     = VFE.starred || { mixes: [], pinned: [] };

  // ── helpers ────────────────────────────────────────────────────────────────
  function albumsOfSource(source) {
    if (Array.isArray(source)) {
      return source.map(s => albums.find(a => a.slug === s)).filter(Boolean);
    }
    if (source === 'archive') return albums.filter(a => a.era === 'archive');
    if (source === 'current') return albums.filter(a => !a.era || a.era === 'current');
    return albums;
  }

  const sumCount = list => list.reduce((s, a) => s + (a.count || 0), 0);

  // Album display title: "Game Name · Subtitle" (subtitle optional). Disambiguates
  // albums that share a game name (former sets, now distinct albums).
  const albumTitle = a => a.subtitle ? `${a.name} · ${a.subtitle}` : a.name;

  function mixCount(mix) {
    const total = sumCount(albumsOfSource(mix.source));
    return mix.count != null ? Math.min(mix.count, total) : total;
  }

  function collectionAlbums(c) {
    return (c.albums || []).map(s => albums.find(a => a.slug === s)).filter(Boolean);
  }

  function link(href, name, count) {
    const meta = count != null ? `<span class="meta">(${count})</span>` : '';
    return `<a href="${href}"><span class="name">${name}</span>${meta}</a>`;
  }

  // Render a list either flat (single era) or split into Current / Archive groups
  // when both eras are present — mirroring how the Starred mixes collapse to "All"
  // under a single era. Missing era counts as current. `linkFn` builds one entry.
  function renderByEra(list, linkFn) {
    const current = list.filter(x => !x.era || x.era === 'current');
    const archive = list.filter(x => x.era === 'archive');
    if (!current.length || !archive.length) return list.map(linkFn).join('');
    return `<span class="alphabet">Current</span>${current.map(linkFn).join('')}`
         + `<span class="alphabet">Archive</span>${archive.map(linkFn).join('')}`;
  }

  // ── Starred (replaces the old "Spotlight" section) ──────────────────────────
  // Hide a mix when its source is empty, or when it's redundant with a mix
  // already shown above it (same album set + same ordering/cap) — e.g. "All
  // Archive" collapses into "All" when every album is archive.
  const mixSig = m =>
    albumsOfSource(m.source).map(a => a.slug).sort().join(',')
    + '|' + (m.random ? 'r' : 'o') + '|' + (m.count != null ? m.count : '');

  const seenSig = new Set();
  const visibleMixes = starred.mixes.filter(m => {
    if (albumsOfSource(m.source).length === 0) return false;
    const sig = mixSig(m);
    if (seenSig.has(sig)) return false;
    seenSig.add(sig);
    return true;
  });

  const mixLinks = visibleMixes
    .map(m => link(`/index.html?mix=${m.id}`, m.name, mixCount(m)))
    .join('');

  const pinnedLinks = (starred.pinned || []).map(p => {
    if (p.type === 'album') {
      const a = albums.find(x => x.slug === p.slug);
      return a ? link(`/index.html?album=${a.slug}`, albumTitle(a), a.count) : '';
    }
    if (p.type === 'series') {
      const s = series.find(x => x.slug === p.slug);
      return s ? link(`/index.html?series=${s.slug}`, s.name, s.count) : '';
    }
    if (p.type === 'collection') {
      const c = collections.find(x => x.slug === p.slug);
      return c ? link(`/index.html?collection=${c.slug}`, c.name, sumCount(collectionAlbums(c))) : '';
    }
    return '';
  }).join('');

  const starredSection = `
    <div>
      <h3>Starred</h3>
      <div class="filters">
        ${mixLinks}
        ${pinnedLinks}
      </div>
    </div>`;

  // ── Explore › Albums (alphabetical) ─────────────────────────────────────────
  function buildAlphaList(list) {
    const byLetter = {};
    list.forEach(album => {
      if (!album.name) return;
      const letter = album.name[0].toUpperCase();
      (byLetter[letter] = byLetter[letter] || []).push(album);
    });
    return Object.entries(byLetter)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([letter, letterAlbums]) => {
        const links = letterAlbums
          .map(a => `
          <a href="/index.html?album=${a.slug}" id="${a.slug}">
            <span class="name">${albumTitle(a)}</span><span class="meta">(${a.count})</span>
          </a>`).join('');
        return `<span class="alphabet">${letter}</span>${links}`;
      }).join('');
  }

  const albumsSection = albums.length ? `
    <div>
      <h3>Albums</h3>
      <div class="filters">
        ${buildAlphaList(albums)}
      </div>
    </div>` : '';

  const seriesSection = series.length ? `
    <div>
      <h3>Series</h3>
      <div class="filters">
        ${renderByEra(series, s => link(`/index.html?series=${s.slug}`, s.name, s.count))}
      </div>
    </div>` : '';

  const collectionsSection = collections.length ? `
    <div>
      <h3>Collections</h3>
      <div class="filters">
        ${renderByEra(collections, c => link(`/index.html?collection=${c.slug}`, c.name, sumCount(collectionAlbums(c))))}
      </div>
    </div>` : '';

  const latestLinks = albums
    .slice(0, 10)
    .map(a => `<a href="/index.html?album=${a.slug}">${albumTitle(a)}</a>`).join('');

  return `
    <header>
      <section class="modal-filter">
        <div class="modal-container">
          <div class="modal">
            <div class="title">
              <h2>Explore By</h2>
              <div class="banner"></div>
            </div>
            <div class="scrollable">
              ${starredSection}
              ${albumsSection}
              ${seriesSection}
              ${collectionsSection}
            </div>
          </div>
        </div>
      </section>
      <section id="header">
        <div class="nav">
          <div class="logo">
            <a href="/index.html">
              <img class="desktop" src="/assets/logo.png" alt="logo">
              <img class="mobile" src="/assets/logo_short.png" alt="logo">
            </a>
          </div>
          <div class="burger modal-filter-trigger">
            <div class="burgerMenu">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span class="burger-text">Explore</span>
          </div>
        </div>
        <div class="banner"></div>
      </section>
    </header>
    <footer>
      <div id="nav-latest">
        <span>Latest Albums</span>
        ${latestLinks}
      </div>
      <div id="footer">
        <div>
          <a href="/about.html"><span class="bold">About</span> <span class="nop">View From Elsewhere</span></a>
        </div>
        <div class="SM">
          <a href="https://go.trognon.space/socials/instagram" target="_blank" aria-label="Instagram">
            <img src="/assets/instagram.svg" alt="" width="20" height="20" />
          </a>
        </div>
      </div>
    </footer>`;
}

document.querySelector('#nav').innerHTML = buildNav(VFE);
