function buildNav(albums) {
  const currentAlbums = albums.filter(a => !a.era || a.era === 'current');
  const archiveAlbums = albums.filter(a => a.era === 'archive');

  function totalImages(list) {
    return list.reduce((sum, a) => sum + a.images.sets.reduce((s, n) => s + n.count, 0), 0);
  }

  function buildAlphaList(list) {
    const byLetter = {};
    list.forEach(album => {
      if (!album.name) return;
      const letter = album.name[0].toUpperCase();
      if (!byLetter[letter]) byLetter[letter] = [];
      byLetter[letter].push(album);
    });

    return Object.entries(byLetter)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([letter, letterAlbums]) => {
        const links = letterAlbums.map(album => `
          <a href="/albums/${album.slug}.html" id="${album.slug}">
            <span class="name">${album.name}</span><span class="meta">(${album.images.sets.reduce((s, n) => s + n.count, 0)})</span>
          </a>`).join('');
        return `<span class="alphabet">${letter}</span>${links}`;
      }).join('');
  }

  const currentSection = currentAlbums.length ? `
    <div>
      <h3>Current<em> · Fresh upload (≥ 2026)</em></h3>
      <div class="filters">
        <a href="/index.html?era=current">
          <span class="name">📍 All Current</span><span class="meta">(${totalImages(currentAlbums)})</span>
        </a>
        ${buildAlphaList(currentAlbums)}
      </div>
    </div>` : '';

  const archiveSection = archiveAlbums.length ? `
    <div>
      <h3>Archive<em> · Explore the original albums (≤ 2023)</em></h3>
      <div class="filters">
        <a href="/index.html?era=archive">
          <span class="name">📍 All Archive</span><span class="meta">(${totalImages(archiveAlbums)})</span>
        </a>
        ${buildAlphaList(archiveAlbums)}
      </div>
    </div>` : '';

  const latestLinks = albums
    .slice(0, 10)
    .map(a => `<a href="/albums/${a.slug}.html">${a.name}</a>`).join('');

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
              <div>
                <h3>Spotlight</h3>
                <div class="filters">
                  <a href="/index.html">
                    <span class="name">🎲 Random Mix</span><span class="meta">(100)</span>
                  </a>
                </div>
              </div>
              ${currentSection}
              ${archiveSection}
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

document.querySelector('#nav').innerHTML = buildNav(VFE.albums);
