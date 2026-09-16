'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, json, deferred, signIn, tick } = require('../test-support/browser');

test('every page shares the theme, navigation labels and correct active location', t => {
  for (const page of ['index.html','saved.html','saved-titles.html','account.html']) {
    const app = browser(page); t.after(app.close); const doc=app.window.document;
    assert.ok(doc.body.classList.contains('flickstuck-theme'),page);
    assert.ok(doc.querySelector('link[href^="./site-theme.css"]'),page);
    assert.deepEqual([...doc.querySelectorAll('.title-bar-nav a')].map(a=>a.textContent),['Discover','Saved people','Watchlist','Account']);
    assert.equal(doc.querySelectorAll('[aria-current="page"]').length,1);
    assert.ok(doc.querySelector('.brand-dot'),page);
  }
});

async function titlesBrowser(t, titles) {
  const app=browser('saved-titles.html'); t.after(app.close);
  app.window.fetch=async()=>json({movies:[]});
  app.load('saved-data-client.js');
  for (const title of titles) await app.window.savedDataClient.toggleTitle(title);
  app.load('movie-results.js'); app.load('discovery-filters.js'); app.load('library-filters.js'); app.load('saved-titles.js');
  return app;
}
function change(app,id,value) { const node=app.window.document.querySelector(id);node.value=value;node.dispatchEvent(new app.window.Event('change',{bubbles:true})); }
const good={id:1,title:'Award Film',mediaType:'movie',year:2020,genres:['Drama'],imdb:8.5,rt:95,tmdb:8,awards:'Won 2 Oscars.',isEnriched:true};
const show={id:'tv:1',title:'Award Series',mediaType:'tv',year:2022,genreIds:[18],imdb:9,rt:90,awards:'Won 3 Primetime Emmys.',isEnriched:true};

test('watchlist awards, actual ratings, legacy genre names and existing type filters work together', async t=>{
  const app=await titlesBrowser(t,[good,show,{id:2,title:'Unknown scores',tmdb:9,isEnriched:true}]);
  change(app,'#library-imdbMin','8');
  assert.equal(app.window.document.querySelectorAll('#saved-titles-grid .movie-card').length,2);
  change(app,'#library-awardFamily','oscar');
  assert.equal(app.window.document.querySelectorAll('#saved-titles-grid .movie-card').length,1);
  assert.match(app.window.document.querySelector('#saved-titles-grid').textContent,/Award Film/);
  change(app,'#library-genre','18');
  assert.equal(app.window.document.querySelectorAll('#saved-titles-grid .movie-card').length,1,'old saved genre names remain usable');
  change(app,'#saved-titles-media-type','tv');
  assert.equal(app.window.document.querySelectorAll('#saved-titles-grid .movie-card').length,0);
  app.window.document.querySelector('#clear-library-view').click();
  assert.equal(app.window.document.querySelectorAll('#saved-titles-grid .movie-card').length,3);
  assert.equal(app.evaluate('viewState.sort'),'recent');
});

test('watchlist sorting keeps missing ratings last without substituting TMDb',async t=>{
  const app=await titlesBrowser(t,[good,show,{id:2,title:'Unknown scores',tmdb:10,isEnriched:true}]);
  change(app,'#saved-titles-sort','rt');
  assert.deepEqual([...app.window.document.querySelectorAll('#saved-titles-grid h3')].map(n=>n.textContent),['Award Film','Award Series','Unknown scores']);
});

test('saved title details load in bounded batches and stay retryable after failures',async t=>{
  const app=browser('saved-titles.html');t.after(app.close);
  app.load('saved-data-client.js');
  for(let id=1;id<=9;id++)await app.window.savedDataClient.toggleTitle({id,title:'Title '+id});
  let running=0,max=0;const batches=[];
  app.window.fetch=async url=>{
    const ids=new URL(url,'https://test.invalid').searchParams.get('ids').split(',').map(Number);batches.push(ids);
    running++;max=Math.max(max,running);await tick();running--;
    return json({movies:ids.filter(id=>id!==2).map(id=>({id,title:'Title '+id,imdb:8,isEnriched:true}))});
  };
  app.load('movie-results.js');app.load('discovery-filters.js');app.load('library-filters.js');app.load('saved-titles.js');
  for(let i=0;i<20;i++)await tick();
  assert.ok(batches.every(ids=>ids.length<=2));assert.ok(max<=2);
  assert.equal(batches.flat().length,8,'default view only preloads its first eight titles');
  assert.equal(app.window.document.querySelector('#retry-library-details').hidden,false);
  assert.ok(app.evaluate('enrichmentFailed.has("2")'));
  app.window.fetch=async()=>json({movies:[{id:2,title:'Title 2',imdb:9,isEnriched:true}]});
  app.window.document.querySelector('#retry-library-details').click();for(let i=0;i<8;i++)await tick();
  assert.equal(app.evaluate('watchlistMovies.get(2).imdb'),9);
});

test('signed-in library metadata renders without changing account saves or looping requests',async t=>{
  const app=browser('saved-titles.html');t.after(app.close);
  app.window.fetch=async()=>json({watchlist:[1],watchlistMovies:[{id:1,title:'Account film'}],watched:[],watchedMovies:[],savedPeople:[]});
  app.load('saved-data-client.js');signIn(app.window,2);await tick();
  let requests=0;
  app.window.fetch=async()=>{requests++;return json({movies:[{id:1,title:'Account film',imdb:9,isEnriched:true}]});};
  app.load('movie-results.js');app.load('discovery-filters.js');app.load('library-filters.js');app.load('saved-titles.js');
  for(let i=0;i<8;i++)await tick();
  change(app,'#library-imdbMin','8');
  assert.equal(app.window.document.querySelectorAll('#saved-titles-grid .movie-card').length,1);
  assert.equal(requests,1);
  assert.equal(app.window.savedDataClient.getSnapshot().watchlistMovies[0].imdb,undefined,'account-owned snapshot stays unchanged');
  app.evaluate('handleSavedDataUpdate(savedDataClient.getSnapshot())');
  assert.equal(app.evaluate('watchlistMovies.get(1).imdb'),9,'details survive same-account notifications');
});

test('late library metadata cannot update saves from a different signed-in account',async t=>{
  const app=browser('saved-titles.html');t.after(app.close);const reply=deferred();
  app.load('saved-data-client.js');await app.window.savedDataClient.toggleTitle({id:1,title:'Guest'});
  app.window.fetch=()=>reply.promise;
  app.load('movie-results.js');app.load('discovery-filters.js');app.load('library-filters.js');app.load('saved-titles.js');await tick();
  app.window.fetch=async()=>json({watchlist:[2],watchlistMovies:[{id:2,title:'Account',isEnriched:true}],watched:[],watchedMovies:[],savedPeople:[]});
  signIn(app.window,2);await tick();reply.resolve(json({movies:[{id:1,title:'Late guest',isEnriched:true}]}));for(let i=0;i<8;i++)await tick();
  assert.deepEqual(Array.from(app.window.savedDataClient.getSnapshot().watchlistIds),[2]);
  assert.doesNotMatch(app.window.document.querySelector('#saved-titles-grid').textContent,/Late guest/);
});

test('saved profiles use distinct categories, retain legacy profiles and support search',async t=>{
  const app=browser('saved.html');t.after(app.close);app.load('saved-data-client.js');
  const profiles=[{id:'1',name:'Actor',department:'Acting',bucket:'actors'},{id:'2',name:'Writer',department:'Writing',bucket:'writers'},
    {id:'3',name:'Director',department:'Directing',bucket:'filmmakers'},{id:'4',name:'Producer',department:'Production',bucket:'filmmakers'},
    {id:'studio:netflix',name:'Netflix',department:'Studio',bucket:'filmmakers'},{id:'5',name:'Legacy filmmaker',department:'Filmmaker',bucket:'filmmakers'}];
  for(const person of profiles)await app.window.savedDataClient.togglePerson(person);
  app.load('movie-results.js');app.load('saved.js');
  for(const key of ['actors','writers','directors','producers','studios','filmmakers'])assert.equal(app.window.document.querySelectorAll('#saved-'+key+'-grid .saved-person-row').length,1,key);
  const search=app.window.document.querySelector('#saved-people-search');search.value='Netflix';search.dispatchEvent(new app.window.Event('input'));
  assert.equal(app.window.document.querySelector('#saved-studios-panel').hidden,false);
  assert.equal(app.window.document.querySelectorAll('.saved-person-row').length,1);
  app.window.document.querySelector('#clear-people-search').click();assert.equal(app.window.document.querySelectorAll('.saved-person-row').length,6);
});

test('saved studios request company catalogues instead of person credits',async t=>{
  const app=browser('saved.html');t.after(app.close);app.load('saved-data-client.js');app.load('movie-results.js');app.load('saved.js');let requested;
  app.window.fetch=async url=>{requested=new URL(url,'https://test.invalid');return json({movies:[]});};
  await app.evaluate('ensurePersonCatalog({id:"studio:netflix",name:"Netflix",department:"Studio"})');
  assert.equal(requested.searchParams.get('searchType'),'studio');assert.equal(requested.searchParams.get('personId'),'');
  assert.equal(requested.searchParams.get('mediaType'),'both');
});

test('profile tabs skip the hidden legacy category and retain keyboard navigation',async t=>{
  const app=browser('saved.html');t.after(app.close);app.load('saved-data-client.js');app.load('movie-results.js');app.load('saved.js');
  const writer=app.window.document.querySelector('#saved-tab-writers');writer.dispatchEvent(new app.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(app.window.document.activeElement.id,'saved-tab-directors');
  assert.equal(app.window.document.querySelector('#saved-directors-panel').hidden,false);
});
