/* Pure fixes used by the locally modified CleanX extension. */
(function(root) {
  'use strict';
  const Core = typeof module === 'object' && module.exports ? require('./core.js') : root.XCountryCore;
  const TTL = 86400000, UNKNOWN_TTL = 600000;
  const extraRegions = ['Middle East and North Africa', 'Northern Europe', 'Western Europe', 'Eastern Europe', 'Southern Europe', 'Northern America', 'Caribbean', 'Central America', 'Southern Africa', 'Eastern Africa', 'Western Africa', 'Middle Africa'];
  function classify(raw, definedRegions=[]) {
    if(typeof raw !== 'string' || !raw.trim() || raw.length>100) return {accountCountry:null,accountRegion:null};
    const normalized=raw.trim();
    const id=Core.locationId(normalized);
    if(Core.catalog.some(c=>c.type==='country' && c.id===id)) return {accountCountry:id,accountRegion:null};
    const regions=[...Core.catalog.filter(c=>c.type==='region').map(c=>c.label),...extraRegions,...definedRegions];
    const region=regions.find(r=>Core.fold(r)===Core.fold(normalized));
    return {accountCountry:null,accountRegion:region || null};
  }
  function parse(json, definedRegions=[]) {
    const result=json?.data?.user_result_by_screen_name?.result || json?.data?.user?.result || json?.user_result_by_screen_name?.result || json?.user?.result;
    if(!result) return {accountCountry:null,accountRegion:null,usernameChanges:null};
    const about=result.about_profile || result.aboutProfile || result.aboutModule || result.about || result.legacy?.about || result.about_account || result;
    const raw=about.account_based_in ?? about.accountBasedIn ?? about.accountCountry ?? null;
    const info=classify(raw,definedRegions);
    const explicit=classify(about.account_region ?? about.accountRegion,definedRegions);
    if(explicit.accountRegion) info.accountRegion=explicit.accountRegion;
    const changes=about.username_changes ?? about.usernameChangeCount ?? about.screen_name_change_count ?? result.legacy?.screen_name_change_count;
    return {...info,usernameChanges:changes !== undefined && changes !== null && changes !== '' && Number.isInteger(Number(changes)) && Number(changes)>=0 ? Number(changes) : null};
  }
  function fresh(entry,now=Date.now()) {
    return !!entry && entry.v===2 && Number.isFinite(entry.ts) && entry.ts<=now && now-entry.ts<(entry.accountCountry || entry.accountRegion ? TTL : UNKNOWN_TTL);
  }
  function prune(cache,now=Date.now()) {
    return Object.fromEntries(Object.entries(cache || {}).filter(([key,value])=>Core.handle(key)===key && fresh(value,now) && (!value.accountCountry || Core.catalog.some(c=>c.type==='country' && c.id===value.accountCountry)) && (!value.accountRegion || typeof value.accountRegion==='string' && value.accountRegion.length<=100)).sort((a,b)=>b[1].ts-a[1].ts).slice(0,2000));
  }
  const api={TTL,UNKNOWN_TTL,classify,parse,fresh,prune};
  if(typeof module==='object' && module.exports) module.exports=api;else root.CleanXHelpers=Object.freeze(api);
})(globalThis);
