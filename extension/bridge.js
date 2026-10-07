/* Runs in X's page world. Credentials stay in this closure; only public labels leave it.
 * Every generated request is a GET to X's AboutAccountQuery. No arbitrary URL RPC.
 */
(() => {
  'use strict';
  const Core = globalThis.XCountryCore;
  const CHANNEL = 'cleanx-local-v1';
  const originalFetch = window.fetch.bind(window);
  let authorization = '', queryId = 'XRqGa7EeokUU5kppkh13EA';
  let active = false, busy = false, nextAt = 0, discovery = null;
  let state = 'waiting-session';
  const examined = new Set();
  const emit = data => window.postMessage({ channel: CHANNEL, direction: 'from-page', ...data }, location.origin);
  const status = value => { state = value; emit({ type: 'status', state, retryAt: nextAt }); };
  function xApi(input) {
    try { const url = new URL(typeof input === 'string' ? input : input.url, location.origin); return url.origin === location.origin && url.pathname.startsWith('/i/api/') ? url : null; } catch { return null; }
  }
  function capture(url, headers) {
    if (!url) return;
    const auth = new Headers(headers || {}).get('authorization');
    if (auth?.startsWith('Bearer ')) authorization = auth;
    const match = /\/graphql\/([\w-]+)\/AboutAccountQuery$/.exec(url.pathname);
    if (match) queryId = match[1];
    if (authorization && state === 'waiting-session') status('ready');
  }
  // Observe only headers X already supplies to its own API. Never persist them.
  window.fetch = function(input, init) {
    try { capture(xApi(input), init?.headers || (input instanceof Request ? input.headers : undefined)); } catch { /* preserve X request */ }
    return originalFetch(input, init);
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try { requests.set(this, { url: xApi(String(url)), headers: {} }); } catch { /* preserve X request */ }
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const info = requests.get(this);
    if (info?.url && String(name).toLowerCase() === 'authorization') info.headers.authorization = value;
    return xhrHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    const info = requests.get(this);
    try { if (info) capture(info.url, info.headers); } catch { /* preserve X request */ }
    return xhrSend.apply(this, args);
  };
  const csrf = () => {
    try { return decodeURIComponent(document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] || ''); } catch { return ''; }
  };
  async function discover() {
    if (discovery) return discovery;
    discovery = (async () => {
      // Inspect public JS already loaded by X, as text only. Never execute remote code.
      const urls = [...document.querySelectorAll('script[src], link[rel="preload"][as="script"]')].map(e => e.src || e.href);
      for (const entry of performance.getEntriesByType('resource')) urls.push(entry.name);
      const candidates = [...new Set(urls)].filter(raw => {
        try { const u = new URL(raw); return u.protocol === 'https:' && u.hostname === 'abs.twimg.com' && u.pathname.startsWith('/responsive-web/client-web/') && u.pathname.endsWith('.js') && !examined.has(raw); } catch { return false; }
      }).sort((a,b)=>Number(/About|UserProfile/.test(b))-Number(/About|UserProfile/.test(a))).slice(0,12);
      const deadline = Date.now() + 6000;
      for (const url of candidates) {
        if (!active || Date.now() >= deadline) break;
        examined.add(url);
        try {
          const response = await originalFetch(url, { credentials: 'omit', signal: AbortSignal.timeout(Math.max(1,deadline-Date.now())) });
          if (!response.ok) continue;
          const text = await response.text();
          const found = Core.operationFromSource(text);
          if (found) { queryId = found; return; }
        } catch { /* observed endpoint / known fallback still available */ }
      }
    })().finally(() => { discovery = null; });
    return discovery;
  }
  function cooldown(response) {
    const retry = response.headers.get('retry-after');
    const seconds = Number(retry);
    const requested = retry ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now()) : 0;
    nextAt = Date.now() + Math.max(15 * 60000, Number.isFinite(requested) ? requested : 0);
    status('rate-limited');
  }
  async function lookup(author, id) {
    if (!active) return emit({type:'result', id, author, error:'paused'});
    if (busy || Date.now() < nextAt) return emit({type:'result', id, author, error:busy ? 'busy' : state === 'ready' ? 'busy' : state, retryAt:nextAt});
    if (!authorization || !csrf()) { status('waiting-session'); return emit({type:'result', id, author, error:'waiting-session'}); }
    busy = true;
    try {
      if (!examined.size) await discover();
      if (!active) return emit({type:'result', id, author, error:'paused'});
      const url = new URL(`/i/api/graphql/${queryId}/AboutAccountQuery`, location.origin);
      url.searchParams.set('variables', JSON.stringify({screenName: author}));
      const response = await originalFetch(url.href, {
        method: 'GET', credentials:'include', redirect:'error', signal:AbortSignal.timeout(12000),
        headers: { authorization, 'x-csrf-token':csrf(), 'x-twitter-active-user':'yes', 'x-twitter-auth-type':'OAuth2Session', 'x-twitter-client-language':'en' }
      });
      nextAt = Date.now() + 2200;
      if (response.status === 429) { cooldown(response); return emit({type:'result',id,author,error:'rate-limited',retryAt:nextAt}); }
      if (response.status === 401 || response.status === 403) {
        nextAt = Date.now() + 10 * 60000; status('session-rejected');
        return emit({type:'result',id,author,error:'session-rejected',retryAt:nextAt});
      }
      if (!response.ok) { nextAt = Date.now() + 60000; status('endpoint-unavailable'); return emit({type:'result',id,author,error:'endpoint-unavailable',retryAt:nextAt}); }
      const json = await response.json();
      if (!json.data?.user_result_by_screen_name?.result) {
        nextAt = Date.now() + 60000; status('endpoint-unavailable');
        return emit({type:'result',id,author,error:'endpoint-unavailable',retryAt:nextAt});
      }
      status('ready');
      const profile = json.data.user_result_by_screen_name.result.about_profile;
      const changes = profile?.username_changes ?? profile?.usernameChangeCount ?? profile?.screen_name_change_count;
      const usernameChanges = changes !== undefined && changes !== null && changes !== '' && Number.isInteger(Number(changes)) && Number(changes) >= 0 ? Number(changes) : null;
      emit({type:'result',id,author,country:Core.parseAbout(json,author),usernameChanges,at:Date.now()});
    } catch {
      nextAt = Date.now() + 30000; status('network-error');
      emit({type:'result',id,author,error:'network-error',retryAt:nextAt});
    } finally { busy = false; }
  }
  window.addEventListener('message', event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== CHANNEL || m.direction !== 'to-page') return;
    if (m.type === 'config') { active = m.active === true; emit({type:'status',state: active ? state : 'paused',retryAt:nextAt}); }
    if (m.type === 'lookup' && typeof m.id === 'string' && m.id.length <= 60) {
      const author = Core.handle(m.author);
      if (author) void lookup(author,m.id);
    }
  });
})();
