"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../discovery-filters');
const { createSuggestionCatalog, roleMatches, shuffle, queue } = require('../lib/suggestion-catalog');
const { discoveryBrowser } = require('../test-support/discovery-browser');
const { json, deferred, tick } = require('../test-support/browser');

test('rating filters use real source scores, pending verification and AND matching', () => {
  const f = F.normalize({ imdbMin: 8, rtMin: 85, metacriticMin: 75, tmdbMin: 7 });
  const title = { id: 1, tmdb: 9.5, imdb: null, rt: null, metacritic: null };
  assert.equal(F.status(title, f), 'pending');
  assert.equal(F.status({ ...title, isEnriched: true }, f), 'exclude', 'never substitute TMDb for IMDb or RT');
  assert.equal(F.status({ ...title, imdb: 8.1, rt: 90, metacritic: 80 }, f), 'match');
  assert.equal(F.status({ ...title, imdb: 8.1, rt: 90, metacritic: 70 }, f), 'exclude');
  assert.equal(F.status({ ...title, tmdb: 5 }, f), 'exclude', 'known failures do not need hydration');
});

test('awards keep each outcome attached to the correct award family', () => {
  assert.equal(F.awardsMatch('Won 2 Oscars. 40 wins & 50 nominations total.', 'winner:oscar'), true);
  assert.equal(F.awardsMatch('Nominated for 1 Oscar. Won 2 BAFTAs.', 'winner:oscar'), false);
  assert.equal(F.awardsMatch('Nominated for 1 Oscar. Won 2 BAFTAs.', 'nominee:oscar'), true);
  assert.equal(F.awardsMatch('Won 16 Primetime Emmys.', 'winner:emmy'), true);
  assert.equal(F.awardsMatch('Nominated for 3 Golden Globes.', 'recognised:golden-globe'), true);
  assert.equal(F.awardsMatch('Won 2 BAFTAs.', 'winner:bafta'), true);
  assert.equal(F.awardsMatch('Won 1 Screen Actors Guild Award.', 'winner:sag'), true);
  assert.equal(F.awardsMatch('Nominated for 2 Critics Choice Awards.', 'nominee:critics-choice'), true);
  assert.equal(F.awardsMatch('N/A', 'winner:any'), false);
  assert.equal(F.awardsMatch('14 wins & 29 nominations.', 'nominee:any'), true);
});

test('genre, year, runtime, votes, series status and watched filters combine safely', () => {
  const title = { id: 'tv:1', mediaType: 'tv', genreIds: [10765], year: 2020, runtime: '45 min / episode', matchScore: 2000, status: 'Ended' };
  const f = F.normalize({ genre: '878', yearFrom: 2010, yearTo: 2025, runtimeMax: 60, votesMin: 1000, seriesStatus: 'ended', hideWatched: true });
  assert.equal(F.status(title, f), 'match');
  assert.equal(F.status(title, f, new Set(['tv:1'])), 'exclude');
  assert.equal(F.status({ ...title, mediaType: 'movie' }, f), 'exclude');
  assert.equal(F.status({ ...title, runtime: 'Unknown' }, f), 'pending');
  assert.equal(F.status({ ...title, runtime: 'Unknown', isEnriched: true }, f), 'exclude');
  assert.equal(F.status(title, { ...f, seriesStatus: 'ongoing' }), 'exclude');
  assert.equal(F.status(title, { ...f, yearFrom: 2025, yearTo: 2010 }), 'exclude');
  assert.deepEqual(F.normalize({ mediaType: 'bad', imdbMin: 100, rtMin: -10, award: 'fake:oscar', genre: '<script>', sort: 'bad' }), { ...F.defaults, imdbMin: 10 });
});

test('sorts are stable, keep unknown ratings last and do not mutate cohorts', () => {
  const titles = [{id:1,title:'Z',imdb:null}, {id:2,title:'B',imdb:9}, {id:3,title:'A',imdb:8}];
  assert.deepEqual(F.sort(titles, 'imdb').map(t=>t.id), [2,3,1]);
  assert.deepEqual(F.sort(titles, 'title').map(t=>t.id), [3,2,1]);
  assert.deepEqual(titles.map(t=>t.id), [1,2,3]);
});

function fixtureCatalog(tmdb, overrides = {}) {
  return createSuggestionCatalog({ tmdb, live: () => true, cache: { getOrLoad: (_,fn) => fn() },
    normalize: (title,type) => ({ id: type === 'tv' ? 'tv:' + title.id : title.id, title: title.title || title.name, mediaType: type,
      year: 2020, matchScore: title.vote_count, genreIds: title.genre_ids || [] }),
    directory: async () => Array.from({length:100}, (_,i) => ({id:i+1,name:'Person '+i})),
    demo: () => [], resolveStudio: async () => ({ id: 25 }), ...overrides });
}
test('each collection contains 50 unique picks with stable and independently refreshable seeds', async () => {
  const calls = [];
  const catalogue = fixtureCatalog(async (path, params) => {
    calls.push({path,params});
    return { total_pages: 100, results: Array.from({length:20}, (_,i) => ({ id: (Number(params.page)-1)*20+i+1, title:'Title '+i, genre_ids:[18], vote_count:1000 })) };
  });
  const first = await catalogue.suggestions({kind:'movie'});
  const same = await catalogue.suggestions({kind:'movie'});
  const next = await catalogue.suggestions({kind:'movie',seed:1});
  assert.equal(first.items.length,50); assert.equal(new Set(first.items.map(t=>t.id)).size,50);
  assert.deepEqual(same,first); assert.notDeepEqual(next.items,first.items);
  const genre = await catalogue.suggestions({kind:'genre',genre:'18'});
  assert.equal(genre.items.length,50);
  assert.ok(genre.items.some(t=>t.mediaType==='tv')); assert.ok(genre.items.some(t=>t.mediaType==='movie'));
  assert.ok(calls.filter(c=>c.params.with_genres).every(c=>c.params.with_genres==='18'));
  for (const kind of ['actors','writers','directors','producers','studios']) assert.equal((await catalogue.suggestions({kind})).items.length,50);
  assert.notDeepEqual(shuffle(first.items,0),shuffle(first.items,1));
});

test('featured credits verify the exact role and include at most two movies and two shows', async () => {
  const credits = Array.from({length:10},(_,i)=>({id:i+1,title:'Credit',name:'Credit',media_type:i<5?'movie':'tv',job:i===0?'Director':'Writer',vote_count:i*100}));
  const catalogue = fixtureCatalog(async () => ({cast:credits,crew:[...credits,credits[9]]}));
  const writers = await catalogue.featuredCredits({kind:'writers',id:12});
  assert.equal(writers.titles.length,4); assert.equal(new Set(writers.titles.map(t=>t.id)).size,4);
  assert.equal(writers.titles.filter(t=>t.mediaType==='tv').length,2);
  assert.equal(writers.titles.some(t=>t.id===1),false);
  assert.equal(roleMatches('actors',{job:'Director'},true),true);
  assert.equal(roleMatches('directors',{job:'Assistant Director'}),false);
  assert.equal(roleMatches('writers',{job:'Creator'}),true);
  assert.equal(roleMatches('producers',{job:'Executive Producer'}),true);
  assert.equal(roleMatches('producers',{job:'Production Assistant'}),false);
});

test('genre collections do not query unsupported movie/TV genre combinations', async () => {
  const calls = []; const catalogue = fixtureCatalog(async (path,params) => { calls.push({path,params}); return {results:[],total_pages:1}; });
  await catalogue.suggestions({kind:'genre',genre:'10764'});
  assert.deepEqual(calls.map(c=>c.path), ['/discover/tv']);
  calls.length=0; await catalogue.suggestions({kind:'genre',genre:'28'});
  assert.equal(calls.find(c=>c.path==='/discover/tv').params.with_genres,'10759');
});

test('upstream queue bounds concurrency and recovers after failures', async () => {
  const request = queue(2); let running=0,max=0;
  const jobs=Array.from({length:8},(_,i)=>request(async()=>{running++;max=Math.max(max,running);await tick();running--;if(i===2)throw Error('retry');return i;}));
  const result = await Promise.allSettled(jobs);
  assert.equal(max,2); assert.equal(result.filter(r=>r.status==='fulfilled').length,7);
  assert.equal(await request(async()=>9),9);
});

const movies = [{id:1,title:'High',tmdb:8.5,year:2020,genreIds:[18]}, {id:2,title:'Low',tmdb:5,year:1999,genreIds:[35]}];
async function populated(t) {
  return discoveryBrowser(t, async url => json({items:url.includes('kind=movie')?movies: url.includes('kind=actors')?[{id:12,name:'Actor'}]:[]}));
}
test('27 persistent rows, local filtering, filter pills and reset retain the cohort', async t => {
  const app = await populated(t), doc=app.window.document;
  assert.equal(doc.querySelectorAll('.suggestion-shelf').length,27);
  let requests=0; app.window.fetch=async()=>{requests++;return json({titles:[]});};
  const range=doc.querySelector('#tmdb-min'); range.value='8'; range.dispatchEvent(new app.window.Event('input',{bubbles:true}));
  assert.equal(doc.querySelectorAll('#shelf-movie [data-title-id]').length,1);
  assert.match(doc.querySelector('#shelf-movie .shelf-subtitle').textContent,/1 of 2 match/);
  assert.equal(requests,0,'known metadata filters immediately without replacing the picks');
  assert.match(doc.querySelector('#active-filters').textContent,/TMDb ≥ 8/);
  doc.querySelector('#active-filters button').click();
  assert.equal(doc.querySelectorAll('#shelf-movie [data-title-id]').length,2);
  assert.equal(doc.querySelectorAll('.suggestion-shelf').length,27);
});

test('refresh only loads its own collection, retains active filters and reports failures with retry', async t => {
  const app=await populated(t); const urls=[];
  app.evaluate('applyFilters({tmdbMin:8})');
  app.window.fetch=async url=>{urls.push(url);return json({items:[{id:3,title:'Fresh',tmdb:9}]});};
  await app.evaluate('loadShelf(discoveryState.rows.get("movie"),true)');
  assert.equal(urls.length,1); assert.match(urls[0],/kind=movie/); assert.match(urls[0],/seed=1/);
  assert.equal(app.evaluate('discoveryState.filters.tmdbMin'),8);
  assert.equal(app.evaluate('discoveryState.rows.get("actors").items.length'),1);
  app.window.fetch=async()=>json({},503);
  await app.evaluate('loadShelf(discoveryState.rows.get("movie"),true)');
  assert.match(app.window.document.querySelector('#shelf-movie').textContent,/Retry collection/);
  assert.equal(app.window.document.querySelectorAll('#shelf-movie [data-title-id]').length,1,'retain existing picks on refresh failure');
});

test('people filter only when a featured title satisfies all filters', async t => {
  const app=await populated(t);
  app.window.fetch=async url=>json(url.includes('suggestion-credits')?{titles:[{id:10,title:'Feature',tmdb:9,imdb:null}]}:{movies:[{id:10,title:'Feature',tmdb:9,imdb:7,isEnriched:true}]});
  app.evaluate('applyFilters({tmdbMin:8,imdbMin:8}); verifyRow(discoveryState.rows.get("actors"))');
  await app.evaluate('discoveryState.rows.get("actors").verification');
  app.evaluate('renderRow(discoveryState.rows.get("actors"))');
  assert.equal(app.window.document.querySelectorAll('#shelf-actors [data-entity-key]').length,0);
  app.evaluate('applyFilters({imdbMin:7})');
  assert.equal(app.window.document.querySelectorAll('#shelf-actors [data-entity-key]').length,1);
});

test('old metadata may be cached but never restores filters after a reset', async t => {
  const app=await populated(t), reply=deferred();
  app.window.fetch=()=>reply.promise;
  app.evaluate('applyFilters({imdbMin:8}); verifyRow(discoveryState.rows.get("movie"))');
  await tick(); app.evaluate('resetFilters()');
  reply.resolve(json({movies:[{...movies[0],imdb:5,isEnriched:true}]}));
  await app.evaluate('discoveryState.rows.get("movie").verification');
  app.evaluate('renderRow(discoveryState.rows.get("movie"))');
  assert.equal(app.window.document.querySelectorAll('#shelf-movie [data-title-id]').length,2);
  assert.equal(app.evaluate('discoveryState.filters.imdbMin'),0);
});

test('search displays partial successes and a retry when one source fails', async t => {
  const app=await populated(t);
  app.window.fetch=async url=>url.includes('title-search')?json({results:movies}):json({},503);
  app.window.document.querySelector('#search-input').value='High'; await app.evaluate('runSearch()');
  assert.equal(app.window.document.querySelectorAll('#search-matches [data-title-id]').length,2);
  assert.match(app.window.document.querySelector('#search-status').textContent,/Retry search/);
  assert.equal(app.window.document.querySelectorAll('#suggestion-collections .suggestion-shelf').length,7);
});

test('selected person requests exact role and ID and stale credits cannot replace a new person', async t => {
  const app=await populated(t), first=deferred(), urls=[];
  app.window.fetch=async url=>{urls.push(url);return url.includes('personId=12')?first.promise:json({movies:[{id:'tv:1',mediaType:'tv',title:'New credits'}]});};
  const old=app.evaluate('selectPerson({id:"12",name:"Old Person",kind:"writers"})');
  await app.evaluate('selectPerson({id:"13",name:"New Person",kind:"directors"})');
  first.resolve(json({movies:[{id:1,title:'Old credits'}]})); await old;
  assert.match(urls[0],/role=writer/); assert.match(urls[0],/mediaType=both/);
  assert.match(app.window.document.querySelector('#person-titles').textContent,/New credits/);
  assert.doesNotMatch(app.window.document.querySelector('#person-titles').textContent,/Old credits/);
  assert.equal(new URL(app.window.location.href).searchParams.get('personId'),'13');
});

test('save, watched and details actions use the shared library without movie/TV collisions', async t => {
  const app=await populated(t), doc=app.window.document;
  doc.querySelector('#shelf-movie [data-title-id="1"] .card-save').click(); await tick();
  assert.deepEqual(Array.from(app.window.savedDataClient.getSnapshot().watchlistIds),[1]);
  assert.equal(doc.querySelector('#watchlist-count').textContent,'1');
  app.evaluate('rememberTitle({id:"tv:1",title:"Show",mediaType:"tv",isEnriched:true})');
  await app.evaluate('openDetails("tv:1")');
  assert.equal(doc.querySelector('#title-details').open,true);
  doc.querySelector('#detail-content [data-watchlist-id]').click(); await tick();
  assert.deepEqual(Array.from(app.window.savedDataClient.getSnapshot().watchlistIds),[1,'tv:1']);
  doc.querySelector('#detail-content [data-watched-id]').click(); await tick();
  assert.deepEqual(Array.from(app.window.savedDataClient.getSnapshot().watchedIds),['tv:1']);
  doc.querySelector('#close-details').click(); assert.equal(doc.querySelector('#title-details').open,false);
});

test('horizontal collections support keyboard movement and labelled controls', async t => {
  const app=await populated(t), doc=app.window.document, track=doc.querySelector('#shelf-movie .shelf-track');
  Object.defineProperty(track,'clientWidth',{value:500}); Object.defineProperty(track,'scrollWidth',{value:1500});
  track.dispatchEvent(new app.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(track.scrollLeft,425);
  track.dispatchEvent(new app.window.KeyboardEvent('keydown',{key:'Home',bubbles:true})); assert.equal(track.scrollLeft,0);
  assert.equal(doc.querySelectorAll('#shelf-movie [aria-label]').length>4,true);
  assert.equal(track.tabIndex,0);
});

test('year inputs accept gradual typing before applying a complete year', async t => {
  const app=await populated(t), field=app.window.document.querySelector('#year-from');
  for (const value of ['2','20','202','2020']) {
    field.value=value; field.dispatchEvent(new app.window.Event('input',{bubbles:true}));
    assert.equal(field.value,value);
  }
  assert.equal(app.evaluate('discoveryState.filters.yearFrom'),2020);
  assert.equal(app.window.document.querySelectorAll('#shelf-movie [data-title-id]').length,1);
});

test('filter URLs restore search, selection and filter controls together', async t => {
  const app=await populated(t);
  app.window.fetch=async()=>json({results:[],movies:[]});
  app.window.history.replaceState({},'', '/?imdbMin=7&mediaType=tv&q=Fargo&scope=tv&personId=12&personName=Writer&category=writers');
  app.window.dispatchEvent(new app.window.PopStateEvent('popstate')); await tick();
  assert.equal(app.evaluate('discoveryState.filters.imdbMin'),7);
  assert.equal(app.window.document.querySelector('#imdb-min').value,'7');
  assert.equal(app.window.document.querySelector('#search-input').value,'Fargo');
  assert.equal(app.evaluate('discoveryState.person.kind'),'writers');
});
