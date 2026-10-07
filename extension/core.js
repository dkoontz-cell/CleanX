/* Shared pure logic. No network, DOM, cookies, or extension APIs. */
(function (root) {
  'use strict';
  const codes = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');
  const regions = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'European Union', 'Middle East', 'South Asia', 'Southeast Asia', 'East Asia', 'Central Asia', 'Western Asia', 'Northern Africa', 'Sub-Saharan Africa', 'Latin America and the Caribbean'];
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const countries = codes.map(code => ({ id: code, label: names.of(code), type: 'country' })).sort((a,b) => a.label.localeCompare(b.label));
  const catalog = [...countries, ...regions.map(label => ({ id: 'region:' + label.toLowerCase(), label, type: 'region' }))];
  const fold = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const aliases = new Map();
  for (const item of catalog) { aliases.set(fold(item.label), item.id); aliases.set(fold(item.id), item.id); }
  for (const [name,id] of Object.entries({ 'usa':'US', 'united states of america':'US', 'uk':'GB', 'great britain':'GB', 'south korea':'KR', 'republic of korea':'KR', 'north korea':'KP', 'russian federation':'RU', 'turkey':'TR', 'türkiye':'TR', 'czech republic':'CZ', 'ivory coast':'CI', 'vietnam':'VN', 'taiwan':'TW', 'palestine':'PS', 'kosovo':'XK' })) aliases.set(name,id);
  const defaults = Object.freeze({ enabled: true, blocked: [], allow: [], allFeeds: false, showLabels: true });
  const handle = value => {
    const clean = String(value || '').trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(clean) ? clean : null;
  };
  const locationId = value => aliases.get(fold(value)) || (fold(value) ? 'label:' + fold(value) : null);
  const label = id => catalog.find(item => item.id === id)?.label || String(id).replace(/^label:|^region:/, '');
  function settings(value) {
    const v = value && typeof value === 'object' ? value : {};
    return {
      enabled: v.enabled !== false,
      blocked: [...new Set((Array.isArray(v.blocked) ? v.blocked : []).filter(x => typeof x === 'string' && x.length < 100))].slice(0,400),
      allow: [...new Set((Array.isArray(v.allow) ? v.allow : []).map(handle).filter(Boolean))].slice(0,500),
      allFeeds: v.allFeeds === true,
      showLabels: v.showLabels !== false
    };
  }
  function decision(config, author, entry, own) {
    if (!config.enabled || !config.blocked.length || author === own || config.allow.includes(author)) return false;
    return !!entry?.country && config.blocked.includes(locationId(entry.country));
  }
  function parseAbout(json, expectedHandle) {
    const result = json?.data?.user_result_by_screen_name?.result;
    if (!result || typeof result !== 'object') return null;
    const returned = handle(result.core?.screen_name || result.legacy?.screen_name);
    if (returned && returned !== handle(expectedHandle)) return null;
    const country = result.about_profile?.account_based_in;
    return typeof country === 'string' && country.trim().length > 0 && country.length <= 100 ? country.trim() : null;
  }
  function pruneCache(cache, now = Date.now()) {
    const entries = Object.entries(cache || {}).filter(([key,entry]) => handle(key) === key && entry && Number.isFinite(entry.at) && entry.at <= now && now - entry.at < (entry.country ? 86400000 : 600000) && (entry.country === null || (typeof entry.country === 'string' && entry.country.length <= 100)));
    entries.sort((a,b) => b[1].at - a[1].at);
    return Object.fromEntries(entries.slice(0,2000));
  }
  function operationFromSource(source) {
    return /queryId\s*:\s*["']([\w-]+)["']\s*,\s*operationName\s*:\s*["']AboutAccountQuery["']/.exec(source)?.[1] || null;
  }
  const api = { catalog, defaults, fold, handle, locationId, label, settings, decision, parseAbout, pruneCache, operationFromSource };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XCountryCore = Object.freeze(api);
})(globalThis);
