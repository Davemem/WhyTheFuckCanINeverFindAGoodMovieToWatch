"use strict";

const F = window.DiscoveryFilters;
const $ = selector => document.querySelector(selector);
const kinds = { movie: 'Movies', tv: 'TV shows', actors: 'Actors', writers: 'Writers', directors: 'Directors', producers: 'Producers', studios: 'Studios' };
const roles = { actors: 'cast', writers: 'writer', directors: 'director', producers: 'producer' };
const departments = { actors: 'Acting', writers: 'Writing', directors: 'Directing', producers: 'Production', studios: 'Studio' };
const discoveryState = {
  filters: F.normalize(Object.fromEntries(new URLSearchParams(location.search))), revision: 0,
  rows: new Map(), titles: new Map(), entities: new Map(), credits: new Map(),
  detailJobs: new Map(), creditJobs: new Map(), failures: new Set(),
  searchVersion: 0, searchScope: 'all', searchAbort: null, searchTimer: null,
  personVersion: 0, personAbort: null, person: null, detailId: null,
  saved: new Set(), watched: new Set(), savedPeople: new Set(), renderTimer: null,
};

function workQueue(limit) {
  const waiting = []; let running = 0;
  function next() {
    while (running < limit && waiting.length) {
      const job = waiting.shift(); running++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { running--; next(); });
    }
  }
  return task => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); next(); });
}
const shelfQueue = workQueue(3), detailQueue = workQueue(3), creditQueue = workQueue(3), verificationQueue = workQueue(7);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, className, action) {
  const node = el('button', className, label); node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}
async function api(path, params = {}, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 30000);
  try {
    const response = await fetch(path + '?' + new URLSearchParams(params), { signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Please try again shortly.' : 'The catalogue is unavailable. Please try again.');
    return await response.json();
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
function rememberTitle(raw) {
  const identity = window.TitleIdentity.identity(raw);
  if (!identity) return null;
  const key = String(identity.id), old = discoveryState.titles.get(key);
  // Lightweight search results must not erase verified scores or credit context.
  const next = old?.isEnriched && !raw.isEnriched ? { ...raw, ...old, ...identity } : { ...old, ...raw, ...identity };
  if (old?.matchReason && raw.isEnriched) next.matchReason = old.matchReason;
  if (!next.genreIds?.length && old?.genreIds?.length) next.genreIds = old.genreIds;
  discoveryState.titles.set(key, next);
  return key;
}
function inferKind(person) {
  const department = String(person.department || person.known_for_department || '').toLowerCase();
  return department.includes('writ') ? 'writers' : department.includes('direct') ? 'directors'
    : department.includes('produc') ? 'producers' : department.includes('studio') ? 'studios' : 'actors';
}
function rememberEntity(raw, kind) {
  if (raw.id == null || !raw.name) return null;
  kind ||= inferKind(raw);
  const key = kind + ':' + raw.id;
  discoveryState.entities.set(key, { ...raw, id: String(raw.id), kind });
  return key;
}
function isEntityRow(row) { return Object.hasOwn(departments, row.kind) || row.kind === 'people'; }
function queueRender() {
  if (discoveryState.renderTimer) return;
  discoveryState.renderTimer = setTimeout(() => {
    discoveryState.renderTimer = null;
    for (const row of discoveryState.rows.values()) renderRow(row);
  }, 60);
}

function makeRow(parent, key, kind, title, options = {}) {
  const section = el('section', 'suggestion-shelf'); section.id = 'shelf-' + key;
  const heading = el('div', 'shelf-heading'), headingText = el('div');
  const h2 = el(options.search ? 'h3' : 'h2', '', title); h2.id = 'heading-' + key;
  section.setAttribute('aria-labelledby', h2.id);
  const subtitle = el('p', 'shelf-subtitle', options.lazy ? 'Loads as you browse' : 'Finding suggestions…');
  headingText.append(h2, subtitle);
  const controls = el('div', 'shelf-controls');
  const row = { key, kind, genre: options.genre || 'all', items: [], seed: 0, loaded: false,
    loading: false, error: '', version: 0, verifiedRevision: -1, signature: '', section, subtitle };
  row.refresh = button('', 'refresh-shelf', () => loadShelf(row, true));
  row.refresh.append(el('span', '', '↻ '), el('span', 'refresh-label', 'Refresh'));
  row.refresh.setAttribute('aria-label', 'Refresh ' + title.toLowerCase());
  row.refresh.hidden = Boolean(options.search);
  row.previous = button('←', '', () => scrollRow(row, -1)); row.previous.setAttribute('aria-label', 'Scroll ' + title.toLowerCase() + ' left');
  row.next = button('→', '', () => scrollRow(row, 1)); row.next.setAttribute('aria-label', 'Scroll ' + title.toLowerCase() + ' right');
  controls.append(row.refresh, row.previous, row.next); heading.append(headingText, controls);
  row.track = el('div', 'shelf-track'); row.track.tabIndex = 0;
  row.track.setAttribute('role', 'region'); row.track.setAttribute('aria-label', title + ', horizontally scrollable');
  row.track.addEventListener('scroll', () => updateArrows(row), { passive: true });
  row.track.addEventListener('keydown', event => {
    if (event.target !== row.track) return;
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') row.track.scrollLeft = 0;
      else if (event.key === 'End') row.track.scrollLeft = row.track.scrollWidth;
      else scrollRow(row, event.key === 'ArrowLeft' ? -1 : 1);
      updateArrows(row);
    }
  });
  section.append(heading, row.track); parent.append(section); discoveryState.rows.set(key, row);
  renderRow(row);
  return row;
}
function updateArrows(row) {
  row.previous.disabled = row.track.scrollLeft <= 2;
  row.next.disabled = row.track.scrollWidth - row.track.clientWidth - row.track.scrollLeft <= 2;
}
function scrollRow(row, direction) {
  const left = direction * Math.max(280, row.track.clientWidth * .85);
  if (typeof row.track.scrollBy === 'function') row.track.scrollBy({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  else row.track.scrollLeft += left;
}
async function loadShelf(row, refresh = false) {
  if (row.loading) return row.request;
  if (refresh) row.seed = (row.seed + 1) % 1000000;
  const version = ++row.version;
  row.loading = true; row.error = ''; row.refresh.disabled = true; renderRow(row);
  row.request = shelfQueue(async () => {
    try {
      const payload = await api('/api/suggestions', { kind: row.kind, genre: row.genre, seed: row.seed });
      if (version !== row.version) return;
      row.items = [...new Set((payload.items || []).slice(0, 50).map(item => isEntityRow(row)
        ? rememberEntity(item, row.kind) : rememberTitle(item)).filter(Boolean))];
      row.loaded = true; row.verifiedRevision = -1; row.track.scrollLeft = 0;
    } catch (error) { if (version === row.version) row.error = error.name === 'AbortError' ? 'This collection took too long to load.' : error.message; }
    finally { if (version === row.version) { row.loading = false; row.refresh.disabled = false; renderRow(row); verifyRow(row); } }
  });
  return row.request;
}
function titleStatus(key) {
  const title = discoveryState.titles.get(key);
  return title ? F.status(title, discoveryState.filters, discoveryState.watched) : 'exclude';
}
function entityStatus(key) {
  if (!F.active(discoveryState.filters)) return 'match';
  const credits = discoveryState.credits.get(key);
  if (!credits) return 'pending';
  const statuses = credits.map(titleStatus);
  return statuses.includes('match') ? 'match' : statuses.includes('pending') ? 'pending' : 'exclude';
}
function ratingPending(key) {
  return ['imdb','rt','metacritic'].includes(discoveryState.filters.sort) && !discoveryState.titles.get(key)?.isEnriched;
}
function renderRow(row) {
  const entities = isEntityRow(row), evaluate = entities ? entityStatus : titleStatus;
  let visible = row.items.filter(key => evaluate(key) === 'match');
  const pending = row.items.filter(key => evaluate(key) === 'pending' || !entities && evaluate(key) === 'match' && ratingPending(key));
  const failed = pending.filter(key => hasFailure(key, entities));
  if (!entities) visible = F.sort(visible.map(key => discoveryState.titles.get(key)), discoveryState.filters.sort).map(t => String(t.id));
  else if (discoveryState.filters.sort === 'title') visible.sort((a,b) => discoveryState.entities.get(a).name.localeCompare(discoveryState.entities.get(b).name));
  const filtered = F.active(discoveryState.filters);
  let summary = row.loaded ? `${visible.length} of ${row.items.length} ${filtered ? 'match' : 'suggestions'}` : 'Loads as you browse';
  if (row.loading) summary = row.loaded ? 'Refreshing this collection…' : 'Finding suggestions…';
  else if (row.error) summary = row.error;
  else if (pending.length) summary += ` · ${pending.length - failed.length} checking${failed.length ? ` · ${failed.length} need a retry` : ''}`;
  else if (row.loaded && !row.items.length) summary = 'No suggestions available in this collection';
  row.subtitle.textContent = summary;
  row.track.setAttribute('aria-busy', String(row.loading));
  // Keep scroll position and keyboard focus when asynchronous scores arrive.
  const signature = JSON.stringify([visible.map(key => entities ? [key, discoveryState.savedPeople.has(discoveryState.entities.get(key).id)]
    : [key, discoveryState.titles.get(key).imdb, discoveryState.titles.get(key).tmdb, discoveryState.saved.has(key)]), summary]);
  if (signature !== row.signature) {
    row.signature = signature;
    const scrollLeft = row.track.scrollLeft;
    const active = row.track.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const fragment = document.createDocumentFragment();
    for (const key of visible) fragment.append(entities ? entityCard(key) : titleCard(key));
    if (!visible.length) {
      const message = row.loading ? 'Loading this collection…' : pending.length - failed.length > 0 ? 'Checking these suggestions against your filters…'
        : row.error ? 'This collection could not be loaded.' : !row.loaded ? 'Suggestions will load when you reach this row.'
          : filtered ? 'No matches in this selection. Loosen your filters or refresh for different picks.' : 'No suggestions are available yet.';
      const empty = el('div', 'shelf-empty', message);
      if (filtered && !row.loading) empty.append(button('Clear filters', '', resetFilters));
      fragment.append(empty);
    }
    if (row.error || failed.length) {
      const retry = el('div', 'shelf-empty');
      retry.append(button(row.error ? 'Retry collection' : 'Retry unavailable checks', '', () => row.error ? loadShelf(row) : retryChecks(row)));
      fragment.append(retry);
    }
    row.track.replaceChildren(fragment); row.track.scrollLeft = scrollLeft;
    if (active) {
      const target = [...row.track.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === active);
      (target || row.track).focus({ preventScroll: true });
    }
  }
  updateArrows(row);
}
function visual(url, name, rating) {
  const frame = el('div', 'compact-visual');
  const fallback = el('span', 'fallback-name', name.split(/\s+/).slice(0,3).map(part => part[0]).join(''));
  frame.append(fallback);
  if (/^https:\/\/image\.tmdb\.org\//.test(url || '')) {
    const image = el('img'); image.src = url; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    fallback.hidden = true; image.addEventListener('error', () => { image.remove(); fallback.hidden = false; }, { once: true }); frame.append(image);
  }
  if (rating) frame.append(el('span', 'compact-rating', rating));
  return frame;
}
function titleCard(key) {
  const title = discoveryState.titles.get(key), card = el('article', 'discovery-card'); card.dataset.titleId = key;
  const open = button('', 'card-open', () => openDetails(key, open)); open.dataset.focusKey = 'open:' + key;
  open.setAttribute('aria-label', `Details for ${title.title}, ${title.mediaType === 'tv' ? 'TV show' : 'movie'}${title.year ? ', ' + title.year : ''}`);
  const rating = title.imdb != null ? `IMDb ${Number(title.imdb).toFixed(1)}` : title.tmdb != null ? `TMDb ${Number(title.tmdb).toFixed(1)}` : '';
  open.append(visual(title.posterUrl, title.title || 'Untitled', rating), el('h3', '', title.title || 'Untitled'),
    el('p', 'compact-meta', `${title.mediaType === 'tv' ? 'TV show' : 'Movie'}${title.year ? ' · ' + title.year : ''}`));
  const save = button('', 'card-save', () => saveItem(save, title)); save.dataset.focusKey = 'save:' + key;
  const saved = discoveryState.saved.has(key); save.textContent = saved ? '✓' : '+';
  save.setAttribute('aria-pressed', String(saved)); save.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${title.title} ${saved ? 'from' : 'to'} watchlist`);
  card.append(open, save); return card;
}
function entityCard(key) {
  const person = discoveryState.entities.get(key), card = el('article', 'discovery-card entity-card' + (person.kind === 'studios' ? ' studio-card' : ''));
  card.dataset.entityKey = key;
  const open = button('', 'card-open', () => selectPerson(person)); open.dataset.focusKey = 'open:' + key;
  open.setAttribute('aria-label', `Browse ${person.name}'s ${kinds[person.kind].toLowerCase()} credits`);
  const known = (person.knownFor || []).map(item => typeof item === 'string' ? item : item.title || item.name).filter(Boolean).slice(0,2).join(' · ');
  open.append(visual(person.profileUrl || person.logoUrl, person.name), el('h3', '', person.name), el('p', 'compact-meta', known || departments[person.kind]));
  const save = button('', 'card-save', () => saveItem(save, person, true)); save.dataset.focusKey = 'save:' + key;
  const saved = discoveryState.savedPeople.has(person.id); save.textContent = saved ? '✓' : '+';
  save.setAttribute('aria-pressed', String(saved)); save.setAttribute('aria-label', `${saved ? 'Unsave' : 'Save'} ${person.name}`);
  card.append(open, save); return card;
}
async function saveItem(control, item, person = false, watched = false) {
  if (control.disabled) return;
  control.disabled = true;
  try {
    if (person) await window.savedDataClient.togglePerson({ ...item, department: departments[item.kind],
      bucket: item.kind === 'actors' ? 'actors' : item.kind === 'writers' ? 'writers' : 'filmmakers', savedAt: new Date().toISOString() });
    else if (watched) await window.savedDataClient.toggleWatched(item);
    else await window.savedDataClient.toggleTitle(item);
  } catch (error) { toast(error.message || 'Your change could not be saved. Please try again.'); }
  finally { control.disabled = false; }
}
let toastTimer;
function toast(message) { $('#discovery-toast').textContent = message; $('#discovery-toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#discovery-toast').hidden = true; }, 5000); }

async function ensureDetails(key, stillNeeded = () => true) {
  if (discoveryState.titles.get(key)?.isEnriched || discoveryState.failures.has('title:' + key)) return;
  if (discoveryState.detailJobs.has(key)) {
    await discoveryState.detailJobs.get(key);
    if (stillNeeded() && !discoveryState.titles.get(key)?.isEnriched && !discoveryState.failures.has('title:' + key)) return ensureDetails(key, stillNeeded);
    return;
  }
  const job = detailQueue(async () => {
    if (!stillNeeded()) return;
    try {
      const payload = await api('/api/enrich', { ids: key });
      const title = (payload.movies || []).find(movie => String(window.TitleIdentity.key(movie)) === key);
      if (!title?.isEnriched) throw new Error('Details unavailable');
      rememberTitle(title); window.savedDataClient?.updateMovieDetails([discoveryState.titles.get(key)]);
    } catch { discoveryState.failures.add('title:' + key); }
    finally { queueRender(); }
  }).finally(() => discoveryState.detailJobs.delete(key));
  discoveryState.detailJobs.set(key, job); return job;
}
async function ensureCredits(key, stillNeeded) {
  if (discoveryState.credits.has(key) || discoveryState.failures.has('entity:' + key)) return;
  if (discoveryState.creditJobs.has(key)) {
    await discoveryState.creditJobs.get(key);
    if (stillNeeded() && !discoveryState.credits.has(key) && !discoveryState.failures.has('entity:' + key)) return ensureCredits(key, stillNeeded);
    return;
  }
  const person = discoveryState.entities.get(key);
  const job = creditQueue(async () => {
    if (!stillNeeded()) return;
    try {
      const payload = await api('/api/suggestion-credits', { kind: person.kind, id: person.id, name: person.name });
      discoveryState.credits.set(key, (payload.titles || []).slice(0,4).map(rememberTitle).filter(Boolean));
    } catch { discoveryState.failures.add('entity:' + key); }
    finally { queueRender(); }
  }).finally(() => discoveryState.creditJobs.delete(key));
  discoveryState.creditJobs.set(key, job); return job;
}
function hasFailure(key, entity) {
  return entity ? discoveryState.failures.has('entity:' + key) || (discoveryState.credits.get(key) || []).some(id => discoveryState.failures.has('title:' + id))
    : discoveryState.failures.has('title:' + key);
}
function retryChecks(row) {
  for (const key of row.items) {
    discoveryState.failures.delete('title:' + key); discoveryState.failures.delete('entity:' + key);
    for (const id of discoveryState.credits.get(key) || []) discoveryState.failures.delete('title:' + id);
  }
  row.verifiedRevision = -1; verifyRow(row); renderRow(row);
}
function verifyRow(row) {
  if (!row.loaded || row.verifiedRevision === discoveryState.revision) return;
  const revision = discoveryState.revision, version = row.version;
  row.verifiedRevision = revision;
  const stillNeeded = () => revision === discoveryState.revision && version === row.version && discoveryState.rows.get(row.key) === row;
  row.verification = verificationQueue(async () => {
    for (const key of row.items) {
      if (!stillNeeded()) return;
      if (isEntityRow(row)) {
        if (entityStatus(key) !== 'pending') continue;
        await ensureCredits(key, stillNeeded);
        for (const id of discoveryState.credits.get(key) || []) {
          if (!stillNeeded() || entityStatus(key) === 'match') break;
          if (titleStatus(id) === 'pending') await ensureDetails(id, stillNeeded);
        }
      } else if (titleStatus(key) === 'pending' || titleStatus(key) === 'match' && ratingPending(key)) await ensureDetails(key, stillNeeded);
    }
    queueRender();
  });
}

function filterLabel(key, value) {
  const labels = { imdbMin: 'IMDb', rtMin: 'Rotten Tomatoes', metacriticMin: 'Metacritic', tmdbMin: 'TMDb' };
  if (labels[key]) return labels[key] + ' ≥ ' + value + (key === 'rtMin' ? '%' : '');
  if (key === 'mediaType') return value === 'tv' ? 'TV shows' : 'Movies';
  if (key === 'genre') return F.genres.find(g => String(g.id) === value)?.name || 'Genre';
  if (key === 'award') { const [outcome,family] = value.split(':'); return F.awardFamilies[family] + ' · ' + ({winner:'winners',nominee:'nominees',recognised:'winners / nominees'}[outcome]); }
  return ({ votesMin: value + '+ votes', yearFrom: 'From ' + value, yearTo: 'Until ' + value, runtimeMax: '≤ ' + value + ' min', seriesStatus: value === 'ended' ? 'Series ended' : 'Series still running', hideWatched: 'Unwatched' })[key];
}
function syncFilters() {
  const f = discoveryState.filters;
  for (const node of document.querySelectorAll('[data-filter]')) {
    if (node.type === 'checkbox') node.checked = f[node.dataset.filter]; else node.value = f[node.dataset.filter];
  }
  for (const name of ['imdb','rt','metacritic','tmdb']) $('#' + name + '-value').textContent = f[name + 'Min'] ? f[name + 'Min'] + (name === 'rt' ? '%' : name === 'metacritic' ? '/100' : '/10') : 'Any';
  for (const node of document.querySelectorAll('[data-media]')) node.setAttribute('aria-pressed', String(node.dataset.media === f.mediaType));
  $('#sort-filter').value = f.sort;
  const [outcome, family] = f.award.split(':'); $('#award-outcome').value = outcome; $('#award-family').value = family || 'any';
  const active = Object.keys(F.defaults).filter(key => key !== 'sort' && String(f[key]) !== String(F.defaults[key]));
  $('#filter-count').textContent = active.length; $('#reset-filters').hidden = !active.length && f.sort === 'suggested';
  $('#active-filters').replaceChildren(...active.map(key => button(filterLabel(key, f[key]) + ' ×', '', () => applyFilters({ [key]: F.defaults[key] }))));
  $('#filter-status').textContent = f.yearFrom && f.yearTo && f.yearFrom > f.yearTo ? 'The start year is after the end year. Adjust the years to see matches.'
    : active.length ? 'Filtering every collection. People and studios match through their featured credits; missing scores are excluded.'
      : f.sort !== 'suggested' ? 'Titles use your selected order. People and studios retain suggested order, except for A–Z.' : '';
}
let verificationTimer;
function applyFilters(change, updateUrl = true) {
  discoveryState.filters = F.normalize({ ...discoveryState.filters, ...change }); discoveryState.revision++;
  syncFilters(); if (updateUrl) writeUrl();
  for (const row of discoveryState.rows.values()) renderRow(row);
  clearTimeout(verificationTimer);
  verificationTimer = setTimeout(() => { for (const row of discoveryState.rows.values()) verifyRow(row); }, 180);
}
function resetFilters() { applyFilters(F.defaults); }
function writeUrl(push = false) {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(discoveryState.filters)) if (String(value) !== String(F.defaults[key])) params.set(key, value);
  if ($('#search-input').value.trim()) params.set('q', $('#search-input').value.trim());
  if (discoveryState.searchScope !== 'all') params.set('scope', discoveryState.searchScope);
  if (discoveryState.person) {
    params.set('personId', discoveryState.person.id); params.set('personName', discoveryState.person.name); params.set('category', discoveryState.person.kind);
  }
  const url = location.pathname + (params.size ? '?' + params : '') + location.hash;
  history[push ? 'pushState' : 'replaceState']({}, '', url);
}
function removeRows(prefix) {
  for (const [key,row] of discoveryState.rows) if (key.startsWith(prefix)) { row.version++; row.section.remove(); discoveryState.rows.delete(key); }
}
function setScope(scope) {
  discoveryState.searchScope = Object.hasOwn(kinds, scope) ? scope : 'all';
  for (const node of document.querySelectorAll('[data-scope]')) node.setAttribute('aria-pressed', String(node.dataset.scope === discoveryState.searchScope));
}
function cancelSearch() {
  clearTimeout(discoveryState.searchTimer); discoveryState.searchVersion++; discoveryState.searchAbort?.abort();
}
function clearSearch(updateUrl = true) {
  cancelSearch(); $('#search-input').value = ''; $('#clear-search').hidden = true; $('#search-results').hidden = true; removeRows('search-');
  if (updateUrl) writeUrl();
}
async function runSearch() {
  cancelSearch();
  const query = $('#search-input').value.trim().slice(0,120), scope = discoveryState.searchScope;
  if (!query) { clearSearch(); return; }
  const version = discoveryState.searchVersion, controller = new AbortController(); discoveryState.searchAbort = controller;
  $('#clear-search').hidden = false; $('#search-results').hidden = false; $('#search-results-title').textContent = `Results for “${query}”`;
  $('#search-status').textContent = 'Searching…'; removeRows('search-'); writeUrl();
  const requests = [];
  if (['all','movie','tv'].includes(scope)) requests.push({ kind: 'titles', label: 'Movies & TV shows', run: () => api('/api/title-search', { query, mediaType: scope === 'all' ? 'both' : scope, limit: 12 }, { signal: controller.signal }) });
  if (scope === 'all' || Object.hasOwn(roles, scope)) requests.push({ kind: scope === 'all' ? 'people' : scope, label: scope === 'all' ? 'People' : kinds[scope], run: () => api('/api/people', { query, limit: 12, ...(scope !== 'all' ? { department: scope } : {}) }, { signal: controller.signal }) });
  if (scope === 'all' || scope === 'studios') requests.push({ kind: 'studios', label: 'Studios', run: () => api('/api/studios', { query }, { signal: controller.signal }) });
  const settled = await Promise.allSettled(requests.map(request => request.run()));
  if (version !== discoveryState.searchVersion) return;
  let count = 0; const failed = [];
  settled.forEach((result,index) => {
    const request = requests[index];
    if (result.status === 'rejected') { failed.push(request.label); return; }
    const items = result.value.results || [];
    if (!items.length) return;
    const row = makeRow($('#search-matches'), 'search-' + request.kind, request.kind, request.label, { search: true });
    row.items = [...new Set(items.slice(0,12).map(item => request.kind === 'titles' ? rememberTitle(item) : rememberEntity(item, request.kind === 'people' ? undefined : request.kind)).filter(Boolean))];
    row.loaded = true; count += row.items.length; renderRow(row); verifyRow(row);
  });
  $('#search-status').textContent = count ? `${count} top matches. Your collection filters also apply here.` : 'No matches. Try a different title or name.';
  if (failed.length) {
    $('#search-status').append(document.createTextNode(` Could not load: ${failed.join(', ')}. `), button('Retry search', 'text-button', runSearch));
  }
}
async function selectPerson(person, updateUrl = true) {
  discoveryState.personAbort?.abort();
  const version = ++discoveryState.personVersion, controller = new AbortController(); discoveryState.personAbort = controller;
  discoveryState.person = person; removeRows('credits-');
  $('#person-results').hidden = false; $('#person-results-title').textContent = person.name;
  $('#person-status').textContent = 'Finding credited movies and TV shows…';
  if (updateUrl) { writeUrl(true); $('#person-results').scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }
  try {
    const payload = await api('/api/discover', { mediaType: 'both', searchType: person.kind === 'studios' ? 'studio' : 'person', personId: /^\d+$/.test(person.id) ? person.id : '', query: person.name, role: roles[person.kind] || 'any' }, { signal: controller.signal });
    if (version !== discoveryState.personVersion) return;
    const row = makeRow($('#person-titles'), 'credits-titles', 'titles', 'Credited titles', { search: true });
    row.items = [...new Set((payload.movies || []).map(rememberTitle).filter(Boolean))]; row.loaded = true; renderRow(row); verifyRow(row);
    $('#person-status').textContent = `${row.items.length} available ${person.kind === 'studios' ? 'production' : departments[person.kind]?.toLowerCase() || ''} credits. Your collection filters apply here too.`;
  } catch (error) {
    if (version !== discoveryState.personVersion) return;
    $('#person-status').textContent = 'These credits could not be loaded. ';
    $('#person-status').append(button('Retry credits', 'text-button', () => selectPerson(person, false)));
  }
}
function closePerson(updateUrl = true) {
  discoveryState.personVersion++; discoveryState.personAbort?.abort(); discoveryState.person = null;
  $('#person-results').hidden = true; removeRows('credits-'); if (updateUrl) writeUrl();
}

let detailTrigger;
function renderDetails() {
  const title = discoveryState.titles.get(discoveryState.detailId);
  if (!title) return;
  $('#detail-heading').textContent = title.title;
  const content = window.MovieResults.buildMovieCard($('#movie-card-template'), title, {
    progressive: true, allowToggleSave: true, isSaved: discoveryState.saved.has(String(title.id)), isWatched: discoveryState.watched.has(String(title.id)),
  });
  $('#detail-content').replaceChildren(content);
  $('#detail-status').textContent = title.isEnriched ? 'Ratings and awards may be unavailable for some titles.' : 'Loading ratings, credits and more…';
  if (title.awards) $('#detail-content').append(el('p', 'detail-awards', 'Awards: ' + title.awards));
}
async function openDetails(key, trigger) {
  discoveryState.detailId = key; detailTrigger = trigger; renderDetails();
  const dialog = $('#title-details');
  if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
  discoveryState.failures.delete('title:' + key); await ensureDetails(key);
  if (discoveryState.detailId !== key || !dialog.open) return;
  renderDetails();
  if (discoveryState.failures.has('title:' + key)) {
    $('#detail-status').textContent = 'Some details could not be loaded. ';
    $('#detail-status').append(button('Retry details', '', () => openDetails(key, trigger)));
  }
}
function closeDetails() {
  const dialog = $('#title-details'); discoveryState.detailId = null;
  if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  detailTrigger?.focus({ preventScroll: true });
}
function restoreUrl() {
  const params = new URLSearchParams(location.search);
  closePerson(false); clearSearch(false);
  applyFilters(F.normalize(Object.fromEntries(params)), false);
  setScope(params.get('scope') || 'all');
  $('#search-input').value = params.get('q') || '';
  const legacyQuery = params.get('personName') || params.get('query');
  if (legacyQuery && (params.has('personId') || params.has('category'))) selectPerson({ id: params.get('personId') || '', name: legacyQuery, kind: Object.hasOwn(departments, params.get('category')) ? params.get('category') : 'actors' }, false);
  else if (legacyQuery && !$('#search-input').value) $('#search-input').value = legacyQuery;
  if ($('#search-input').value) runSearch();
}

function startDiscovery() {
  for (const genre of F.genres) { const option = el('option', '', genre.name); option.value = genre.id; $('#genre-filter').append(option); }
  for (const [kind,name] of Object.entries(kinds)) loadShelf(makeRow($('#suggestion-collections'), kind, kind, 'Suggested 50 ' + name.toLowerCase()));
  const genres = F.genres.map(genre => makeRow($('#genre-shelves'), 'genre-' + genre.id, 'genre', 'Suggested 50 · ' + genre.name, { genre: String(genre.id), lazy: true }));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { const row = genres.find(row => row.section === entry.target); observer.unobserve(entry.target); loadShelf(row); }
    }), { rootMargin: '500px' });
    genres.forEach(row => observer.observe(row.section));
  } else genres.forEach(row => loadShelf(row));
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); runSearch(); });
  $('#search-input').maxLength = 120;
  $('#search-input').addEventListener('input', () => {
    cancelSearch(); $('#clear-search').hidden = !$('#search-input').value;
    if (!$('#search-input').value.trim()) { clearSearch(); return; }
    $('#search-status').textContent = 'Waiting for your search…';
    removeRows('search-'); discoveryState.searchTimer = setTimeout(runSearch, 300); writeUrl();
  });
  $('#search-input').addEventListener('keydown', event => { if (event.key === 'Escape') { clearSearch(); event.preventDefault(); } });
  $('#search-scopes').addEventListener('click', event => { const scope = event.target.closest('[data-scope]'); if (scope) { setScope(scope.dataset.scope); writeUrl(); runSearch(); } });
  $('#clear-search').addEventListener('click', () => { clearSearch(); $('#search-input').focus(); });
  $('#close-results').addEventListener('click', () => { clearSearch(); $('#search-input').focus(); });
  $('#close-person').addEventListener('click', () => closePerson());
  $('#filter-toggle').addEventListener('click', () => { const open = $('#filters-panel').hidden; $('#filters-panel').hidden = !open; $('#filter-toggle').setAttribute('aria-expanded', String(open)); });
  $('#filters-panel').addEventListener('submit', event => event.preventDefault());
  $('#filters-panel').addEventListener('input', event => {
    const input = event.target;
    // Let people type a complete year before normalizing the control's value.
    if (['yearFrom','yearTo'].includes(input.dataset.filter) && input.value && !/^\d{4}$/.test(input.value)) return;
    if (input.dataset.filter) applyFilters({ [input.dataset.filter]: input.type === 'checkbox' ? input.checked : input.value });
  });
  for (const node of document.querySelectorAll('#year-from, #year-to')) node.addEventListener('change', () => applyFilters({ [node.dataset.filter]: node.value }));
  for (const id of ['award-family','award-outcome']) $('#' + id).addEventListener('change', () => {
    if (id === 'award-family' && $('#award-outcome').value === 'all') $('#award-outcome').value = 'recognised';
    applyFilters({ award: $('#award-outcome').value === 'all' ? 'all' : $('#award-outcome').value + ':' + $('#award-family').value });
  });
  for (const node of document.querySelectorAll('[data-media]')) node.addEventListener('click', () => applyFilters({ mediaType: node.dataset.media }));
  $('#sort-filter').addEventListener('change', event => applyFilters({ sort: event.target.value }));
  $('#reset-filters').addEventListener('click', resetFilters);
  $('#close-details').addEventListener('click', closeDetails);
  $('#title-details').addEventListener('cancel', () => { discoveryState.detailId = null; });
  $('#title-details').addEventListener('click', event => { if (event.target === $('#title-details')) closeDetails(); });
  $('#detail-content').addEventListener('click', event => {
    const save = event.target.closest('[data-watchlist-id], [data-watched-id]');
    if (save) saveItem(save, discoveryState.titles.get(discoveryState.detailId), false, save.hasAttribute('data-watched-id'));
  });
  window.addEventListener('resize', () => { for (const row of discoveryState.rows.values()) updateArrows(row); }, { passive: true });
  window.addEventListener('popstate', restoreUrl);
  window.savedDataClient?.subscribe(snapshot => {
    discoveryState.saved = new Set((snapshot.watchlistIds || []).map(String));
    discoveryState.watched = new Set((snapshot.watchedIds || []).map(String));
    discoveryState.savedPeople = new Set((snapshot.savedPeople || []).map(person => String(person.id)));
    $('#watchlist-count').textContent = discoveryState.saved.size;
    if (discoveryState.filters.hideWatched) { discoveryState.revision++; for (const row of discoveryState.rows.values()) verifyRow(row); }
    queueRender(); if (discoveryState.detailId) renderDetails();
  });
  restoreUrl();
}
startDiscovery();
