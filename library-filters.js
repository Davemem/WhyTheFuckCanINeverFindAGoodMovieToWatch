(function (global) {
  'use strict';
  const F = global.DiscoveryFilters;
  function mount(root, onChange) {
    let filters = F.normalize();
    const controls = new Map();
    const make = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
    const button = (text, action) => { const node = make('button', text, 'ghost-button'); node.type = 'button'; node.addEventListener('click', action); return node; };
    root.classList.add('library-filters');
    const actions = make('div', '', 'library-filter-actions');
    const panel = make('div', '', 'library-filter-grid'); panel.hidden = true; panel.id = 'library-filter-panel';
    const toggle = button('More filters', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
    toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls',panel.id);
    const clear = button('Clear filters', reset); clear.hidden = true;
    actions.append(toggle,clear);
    const active = make('div', '', 'library-active-filters'); active.setAttribute('aria-label','Active library filters');
    const note = make('p','Actual source scores only. Missing scores are excluded; awards use OMDb summaries, not a complete awards database. TV year means first aired; length means an episode.','library-filter-note');
    const definitions = [
      ['imdbMin','IMDb minimum',[[0,'Any'],[6,'6+'],[7,'7+'],[7.5,'7.5+'],[8,'8+'],[8.5,'8.5+'],[9,'9+']]],
      ['rtMin','Rotten Tomatoes minimum',[[0,'Any'],[60,'60%+'],[70,'70%+'],[80,'80%+'],[90,'90%+'],[95,'95%+']]],
      ['metacriticMin','Metacritic minimum',[[0,'Any'],[50,'50+'],[60,'60+'],[70,'70+'],[80,'80+'],[90,'90+']]],
      ['tmdbMin','TMDb minimum',[[0,'Any'],[6,'6+'],[7,'7+'],[8,'8+'],[9,'9+']]],
      ['awardFamily','Award',Object.entries(F.awardFamilies)],
      ['awardOutcome','Recognition',[['all','Any / none'],['winner','Winners'],['nominee','Nominees'],['recognised','Winners or nominees']]],
      ['genre','Genre',[['all','All genres'],...F.genres.map(g=>[g.id,g.name])]],
      ['votesMin','Minimum audience votes',[[0,'Any'],[100,'100+ TMDb votes'],[1000,'1,000+ TMDb votes'],[10000,'10,000+ TMDb votes']]],
      ['yearFrom','From year'],['yearTo','To year'],
      ['runtimeMax','Maximum length',[[0,'Any'],[30,'30 minutes'],[60,'1 hour'],[90,'90 minutes'],[120,'2 hours'],[150,'2½ hours']]],
      ['seriesStatus','Series status',[['all','Any'],['ongoing','Still running'],['ended','Ended or cancelled']]],
    ];
    for (const [key,label,options] of definitions) {
      const wrapper = make('label',label); const input = make(options ? 'select' : 'input'); input.id = 'library-' + key;
      if (options) for (const [value,text] of options) { const option = make('option',text); option.value = value; input.append(option); }
      else { input.type = 'number'; input.min = '1888'; input.max = '2100'; input.placeholder = 'Any'; }
      input.addEventListener('change', () => {
        if (key === 'awardFamily' && controls.get('awardOutcome').value === 'all') controls.get('awardOutcome').value = 'recognised';
        const values = Object.fromEntries([...controls].filter(([k])=>!k.startsWith('award')).map(([k,input])=>[k,input.value]));
        const outcome = controls.get('awardOutcome').value;
        values.award = outcome === 'all' ? 'all' : outcome + ':' + controls.get('awardFamily').value;
        filters = F.normalize(values); sync(); onChange(filters);
      });
      wrapper.append(input); panel.append(wrapper); controls.set(key,input);
    }
    root.append(actions,panel,active,note);
    function sync() {
      const [outcome,family] = filters.award.split(':');
      for (const [key,input] of controls) input.value = key === 'awardFamily' ? family || 'any' : key === 'awardOutcome' ? outcome : filters[key];
      const keys = Object.keys(F.defaults).filter(key=>String(filters[key]) !== String(F.defaults[key]));
      toggle.textContent = keys.length ? `More filters (${keys.length})` : 'More filters'; clear.hidden = !keys.length;
      active.replaceChildren(...keys.map(key => {
        const input = controls.get(key);
        const label = key === 'award' ? `${F.awardFamilies[family]} · ${outcome}` : definitions.find(d=>d[0]===key)?.[1] + ': ' + (input?.selectedOptions?.[0]?.textContent || filters[key]);
        return button(label + ' ×', () => { filters = F.normalize({...filters,[key]:F.defaults[key]}); sync(); onChange(filters); });
      }));
    }
    function reset() { filters = F.normalize(); sync(); onChange(filters); }
    sync();
    return { getFilters: () => filters, reset };
  }
  global.LibraryFilters = { mount };
})(window);
