(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscoveryFilters = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const defaults = { mediaType: 'both', genre: 'all', imdbMin: 0, rtMin: 0, metacriticMin: 0,
    tmdbMin: 0, votesMin: 0, yearFrom: '', yearTo: '', runtimeMax: 0, award: 'all',
    seriesStatus: 'all', hideWatched: false, sort: 'suggested' };
  const genres = [[28,'Action'],[12,'Adventure'],[16,'Animation'],[35,'Comedy'],[80,'Crime'],
    [99,'Documentary'],[18,'Drama'],[10751,'Family'],[14,'Fantasy'],[36,'History'],[27,'Horror'],
    [10402,'Music'],[9648,'Mystery'],[10749,'Romance'],[878,'Sci-Fi'],[53,'Thriller'],
    [10752,'War'],[37,'Western'],[10764,'Reality'],[10762,'Kids']].map(([id,name])=>({id,name}));
  const awardFamilies = { any:'Any award', oscar:'Oscars', emmy:'Emmys', 'golden-globe':'Golden Globes',
    bafta:'BAFTAs', sag:'Screen Actors Guild', 'critics-choice':'Critics Choice' };
  function number(value, max) { return Math.max(0, Math.min(max, Number(value) || 0)); }
  function normalize(input = {}) {
    const f = { ...defaults, ...input };
    f.mediaType = ['both','movie','tv'].includes(f.mediaType) ? f.mediaType : 'both';
    f.genre = genres.some(g => String(g.id) === String(f.genre)) ? String(f.genre) : 'all';
    for (const k of ['imdbMin','tmdbMin']) f[k] = number(f[k], 10);
    for (const k of ['rtMin','metacriticMin']) f[k] = number(f[k], 100);
    f.votesMin = number(f.votesMin, 1000000); f.runtimeMax = number(f.runtimeMax, 1000);
    for (const k of ['yearFrom','yearTo']) f[k] = /^\d{4}$/.test(String(f[k])) ? number(f[k], 2100) : '';
    f.hideWatched = f.hideWatched === true || f.hideWatched === 'true';
    f.seriesStatus = ['all','ended','ongoing'].includes(f.seriesStatus) ? f.seriesStatus : 'all';
    f.sort = ['suggested','imdb','rt','metacritic','tmdb','year-desc','year-asc','title'].includes(f.sort) ? f.sort : 'suggested';
    const [outcome, family] = String(f.award).split(':');
    if (!['winner','nominee','recognised'].includes(outcome) || !awardFamilies[family]) f.award = 'all';
    return f;
  }
  function mappedGenres(id, type) {
    const mapping = type === 'tv' ? {28:[10759],12:[10759],878:[10765],14:[10765],10752:[10768]}
      : {10759:[28,12],10765:[878,14],10768:[10752]};
    return mapping[id] || [Number(id)];
  }
  function awardsMatch(text, filter) {
    if (!filter || filter === 'all') return true;
    const [outcome, family] = filter.split(':');
    const tokens = { oscar:'oscars?', emmy:'(?:primetime )?emm(?:y|ies)', 'golden-globe':'golden globes?',
      bafta:'baftas?', sag:'(?:screen actors guild|actors?) awards?', 'critics-choice':"critics[’']? choice(?: awards?)?" };
    const award = tokens[family];
    // Keep outcomes inside their own clauses, not another award's win or nomination.
    return String(text || '').toLowerCase().split(/[.;]|\b(?:and|&)\b/).some(clause => {
      const win = /\b(?:won|wins?|winner)\b/.test(clause);
      const nomination = /\bnominat(?:ed|ions?|ee)\b/.test(clause);
      if (family !== 'any' && (!award || !new RegExp(award, 'i').test(clause))) return false;
      return outcome === 'winner' ? win : outcome === 'nominee' ? nomination : win || nomination;
    });
  }
  function needsDetails(f) { return f.imdbMin > 0 || f.rtMin > 0 || f.metacriticMin > 0 || f.award !== 'all' || f.runtimeMax > 0 || f.seriesStatus !== 'all'; }
  function active(f) { return Object.keys(defaults).some(k => k !== 'sort' && String(f[k]) !== String(defaults[k])); }
  function status(title, f, watched = new Set()) {
    const type = title.mediaType || (String(title.id).startsWith('tv:') ? 'tv' : 'movie');
    if (f.mediaType !== 'both' && type !== f.mediaType) return 'exclude';
    if (f.hideWatched && (watched.has(title.id) || watched.has(String(title.id)))) return 'exclude';
    if (f.genre !== 'all' && !mappedGenres(f.genre, type).some(id => (title.genreIds || []).includes(id))) return 'exclude';
    if (f.yearFrom && (!title.year || title.year < f.yearFrom)) return 'exclude';
    if (f.yearTo && (!title.year || title.year > f.yearTo)) return 'exclude';
    if (f.tmdbMin > 0 && (title.tmdb == null || title.tmdb < f.tmdbMin)) return 'exclude';
    if (f.votesMin > 0 && Number(title.voteCount ?? title.matchScore ?? 0) < f.votesMin) return 'exclude';
    let pending = false;
    for (const [field,min] of [['imdb',f.imdbMin],['rt',f.rtMin],['metacritic',f.metacriticMin]]) {
      if (!min) continue;
      if (title[field] == null) { if (!title.isEnriched) pending = true; else return 'exclude'; }
      else if (title[field] < min) return 'exclude';
    }
    if (f.award !== 'all') {
      if (!title.isEnriched && !title.awards) pending = true;
      else if (!awardsMatch(title.awards, f.award)) return 'exclude';
    }
    if (f.runtimeMax) {
      const runtime = Number(title.runtimeMinutes) || parseInt(title.runtime, 10);
      if (!runtime) { if (!title.isEnriched) pending = true; else return 'exclude'; }
      else if (runtime > f.runtimeMax) return 'exclude';
    }
    if (f.seriesStatus !== 'all') {
      if (type !== 'tv') return 'exclude';
      if (!title.isEnriched && !title.status) pending = true;
      else if (f.seriesStatus === 'ended' ? !['Ended','Canceled'].includes(title.status)
        : !['Returning Series','In Production','Planned'].includes(title.status)) return 'exclude';
    }
    return pending ? 'pending' : 'match';
  }
  function sort(titles, by) {
    return [...titles].sort((a,b) => {
      if (by === 'title') return a.title.localeCompare(b.title);
      if (by === 'year-asc') return (a.year || 9999) - (b.year || 9999);
      if (by === 'year-desc') return (b.year || 0) - (a.year || 0);
      if (['imdb','rt','metacritic','tmdb'].includes(by)) return (b[by] ?? -1) - (a[by] ?? -1);
      return 0;
    });
  }
  return { defaults, genres, awardFamilies, normalize, awardsMatch, mappedGenres, needsDetails, active, status, sort };
});
