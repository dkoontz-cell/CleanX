(function () {
	"use strict";
	// Local changes based on theesfeld/CleanX, commit 80fd4db.
	const Helpers = globalThis.CleanXHelpers;
	const Core = globalThis.XCountryCore;
	const CHANNEL = "cleanx-local-v1";
	let bridgeState = "waiting-session", bridgeRetryAt = 0, bridgeSequence = 0;
	const bridgePending = new Map();
	let fetchBusy = false, saveTimer = null, saveChain = Promise.resolve();
	let followingBusy = false;
	function postBridge(data) {
		window.postMessage({channel:CHANNEL,direction:"to-page",...data},location.origin);
	}
	function updateLookupStatus() {
		const el=document.getElementById("xcb-lookup-status");
		if(!el) return;
		const messages={ready:"Connected to X", "waiting-session":"Refresh X to connect your session", "rate-limited":"X rate limit: lookups paused", "session-rejected":"X rejected the lookup: refresh or open an About-account page", "endpoint-unavailable":"Endpoint unavailable: open a profile’s About-account view", "network-error":"Network error: waiting to retry", "bridge-timeout":"Connection timed out: refresh X", paused:"Lookups paused"};
		let text=messages[bridgeState] || "Checking account locations";
		if(bridgeRetryAt>Date.now()+5000) text+=" · Retry in "+Math.ceil((bridgeRetryAt-Date.now())/60000)+" min";
		if(el.textContent!==text) el.textContent=text;
	}
	window.addEventListener("message",event=> {
		const m=event.data;
		if(event.source!==window || event.origin!==location.origin || m?.channel!==CHANNEL || m.direction!=="from-page") return;
		if(m.type==="status" && typeof m.state==="string" && m.state.length<60) {
			bridgeState=m.state;
			if(Number.isFinite(m.retryAt)) bridgeRetryAt=Math.max(bridgeRetryAt,m.retryAt);
			updateLookupStatus();
		}
		if(m.type!=="result") return;
		const pending=bridgePending.get(m.id);
		if(!pending || pending.author!==m.author) return;
		bridgePending.delete(m.id);clearTimeout(pending.timer);
		if(m.error) {
			bridgeState=String(m.error).slice(0,60);
			bridgeRetryAt=Math.max(Date.now()+5000,Number.isFinite(m.retryAt)?m.retryAt:0);
			updateLookupStatus();pending.reject(new Error(bridgeState));
		} else if(m.country===null || (typeof m.country==="string" && m.country.length<=100)) {
			pending.resolve({country:m.country,usernameChanges:Number.isInteger(m.usernameChanges)&&m.usernameChanges>=0?m.usernameChanges:null});
		} else pending.reject(new Error("Invalid location response"));
	});
	function requestAbout(author) {
		if(!Core.handle(author)) return Promise.reject(new Error("Invalid account handle"));
		if(Date.now()<bridgeRetryAt) return Promise.reject(new Error(bridgeState));
		return new Promise((resolve,reject)=> {
			const id=String(++bridgeSequence);
			const timer=setTimeout(()=> {bridgePending.delete(id);bridgeState="bridge-timeout";bridgeRetryAt=Date.now()+30000;updateLookupStatus();reject(new Error("Lookup timed out"));},20000);
			bridgePending.set(id,{author,resolve,reject,timer});
			postBridge({type:"config",active:true});postBridge({type:"lookup",author,id});
		});
	}
	function currentInfo(author) {
		const entry=config.knownUsers[author];
		return Helpers.fresh(entry) ? entry : null;
	}

	if (!/^https?:\/\/(x|twitter)\.com\//.test(window.location.href)) return;

	const STORAGE_KEY = "xCountryBlocker";
	const defaultTotals = () => ({
		overall: 0,
		country: {},
		lang: {},
		region: {},
		session: 0,
	});
	const defaultAnalytics = () => ({
		seenTotal: 0,
		seenCountry: {},
		seenRegion: {},
	});
	let config = {
		blockedCountries: new Set(), // ← EMPTY
		blockedLangs: new Set(), // ← EMPTY
		blockedRegions: new Set(), // ← EMPTY
		countryDB: {}, // code -> [usernames]
		knownUsers: Object.create(null), // username -> { accountCountry, accountRegion, usernameChanges, ts, v }
		pending: new Set(),
		filterMode: "block", // "block" | "highlight"
		filterTotals: defaultTotals(),
		highlightRegionDisplayOnly: false,
		analytics: defaultAnalytics(),
	};
	const fetchQueue = [];

	const nowTs = () => Date.now();
	let filteredCount = 0;
	let totalsSaveTimer = null;
	let nextFetchAllowed = 0;
	const FETCH_GAP_MS = 3500; // throttle outbound requests
	const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000; // minimum backoff; bridge honors Retry-After
	const UNKNOWN_RETRY_MS = 10 * 60 * 1000; // retry unknowns after 10m
	const FOLLOW_SCAN_MAX = 800; // limit following scan
	const FOLLOW_FETCH_DELAY = 3500;
	const PREFETCH_BATCH = 1;
	const PREFETCH_INTERVAL_MS = 4000;
	const blockStats = { country: {}, lang: {}, region: {} }; // session-only counts

	const BEARER_TOKEN =
		"AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";


	// Full country map (unchanged)
	const COUNTRY_MAP = {
		/* same huge list as before */ Afghanistan: "AF",
		Albania: "AL",
		Algeria: "DZ",
		Andorra: "AD",
		Angola: "AO",
		Argentina: "AR",
		Armenia: "AM",
		Australia: "AU",
		Austria: "AT",
		Azerbaijan: "AZ",
		Bahamas: "BS",
		Bahrain: "BH",
		Bangladesh: "BD",
		Barbados: "BB",
		Belarus: "BY",
		Belgium: "BE",
		Belize: "BZ",
		Benin: "BJ",
		Bhutan: "BT",
		Bolivia: "BO",
		"Bosnia and Herzegovina": "BA",
		Botswana: "BW",
		Brazil: "BR",
		Bulgaria: "BG",
		"Burkina Faso": "BF",
		Burundi: "BI",
		Cambodia: "KH",
		Cameroon: "CM",
		Canada: "CA",
		Chile: "CL",
		China: "CN",
		Colombia: "CO",
		"Costa Rica": "CR",
		Croatia: "HR",
		Cuba: "CU",
		Cyprus: "CY",
		Czechia: "CZ",
		Denmark: "DK",
		"Dominican Republic": "DO",
		Ecuador: "EC",
		Egypt: "EG",
		"El Salvador": "SV",
		Estonia: "EE",
		Ethiopia: "ET",
		Finland: "FI",
		France: "FR",
		Georgia: "GE",
		Germany: "DE",
		Ghana: "GH",
		Greece: "GR",
		Guatemala: "GT",
		Honduras: "HN",
		Hungary: "HU",
		Iceland: "IS",
		India: "IN",
		Indonesia: "ID",
		Iran: "IR",
		Iraq: "IQ",
		Ireland: "IE",
		Israel: "IL",
		Italy: "IT",
		Jamaica: "JM",
		Japan: "JP",
		Jordan: "JO",
		Kazakhstan: "KZ",
		Kenya: "KE",
		Kuwait: "KW",
		Latvia: "LV",
		Lebanon: "LB",
		Libya: "LY",
		Lithuania: "LT",
		Luxembourg: "LU",
		Madagascar: "MG",
		Malaysia: "MY",
		Maldives: "MV",
		Mexico: "MX",
		Monaco: "MC",
		Morocco: "MA",
		Nepal: "NP",
		Netherlands: "NL",
		"New Zealand": "NZ",
		Nigeria: "NG",
		Norway: "NO",
		Oman: "OM",
		Pakistan: "PK",
		Panama: "PA",
		Paraguay: "PY",
		Peru: "PE",
		Philippines: "PH",
		Poland: "PL",
		Portugal: "PT",
		Qatar: "QA",
		Romania: "RO",
		Russia: "RU",
		"Saudi Arabia": "SA",
		Senegal: "SN",
		Serbia: "RS",
		Singapore: "SG",
		Slovakia: "SK",
		Slovenia: "SI",
		"South Africa": "ZA",
		"South Korea": "KR",
		Spain: "ES",
		"Sri Lanka": "LK",
		Sweden: "SE",
		Switzerland: "CH",
		Taiwan: "TW",
		Thailand: "TH",
		Tunisia: "TN",
		Turkey: "TR",
		Ukraine: "UA",
		"United Arab Emirates": "AE",
		"United Kingdom": "GB",
		"United States": "US",
		Uruguay: "UY",
		Venezuela: "VE",
		Vietnam: "VN",
		Yemen: "YE",
		Zimbabwe: "ZW",
	};

	const LANG_SCRIPTS = {
		hi: /[\u0900-\u097F]/,
		ta: /[\u0B80-\u0BFF]/,
		te: /[\u0C00-\u0C7F]/,
		kn: /[\u0C80-\u0CFF]/,
		ml: /[\u0D00-\u0D7F]/,
		he: /[\u0590-\u05FF]/,
		ur: /[\u0600-\u06FF]/,
		pa: /[\u0A00-\u0A7F]/,
		ar: /[\u0600-\u06FF]/,
		fa: /[\u0600-\u06FF]/,
		ps: /[\u0600-\u06FF]/,
	};

	const REGION_DEFS = [
		{
			name: "Africa",
			codes: [
				"DZ",
				"AO",
				"BJ",
				"BW",
				"BF",
				"BI",
				"CM",
				"CV",
				"CF",
				"TD",
				"KM",
				"CG",
				"CD",
				"DJ",
				"EG",
				"GQ",
				"ER",
				"ET",
				"GA",
				"GM",
				"GH",
				"GN",
				"GW",
				"CI",
				"KE",
				"LS",
				"LR",
				"LY",
				"MG",
				"MW",
				"ML",
				"MR",
				"MU",
				"MA",
				"MZ",
				"NA",
				"NE",
				"NG",
				"RE",
				"RW",
				"ST",
				"SN",
				"SC",
				"SL",
				"SO",
				"ZA",
				"SS",
				"SD",
				"SZ",
				"TZ",
				"TG",
				"TN",
				"UG",
				"YT",
				"ZM",
				"ZW",
			],
		},
		{
			name: "Middle East and North Africa",
			codes: [
				"IR",
				"IQ",
				"IL",
				"JO",
				"LB",
				"SA",
				"AE",
				"QA",
				"BH",
				"KW",
				"EG",
				"MA",
				"DZ",
				"TN",
				"LY",
				"TR",
				"OM",
				"YE",
				"SY",
				"PS",
			],
		},
		{
			name: "South Asia",
			codes: ["IN", "PK", "BD", "LK", "NP", "AF", "MV", "BT"],
		},
		{
			name: "Southeast Asia",
			codes: ["SG", "TH", "VN", "MY", "ID", "PH", "KH", "LA", "MM", "BN"],
		},
		{
			name: "East Asia and Pacific",
			codes: [
				"CN",
				"JP",
				"KR",
				"TW",
				"PH",
				"ID",
				"TH",
				"VN",
				"MY",
				"SG",
				"AU",
				"NZ",
				"HK",
				"MO",
				"PG",
				"FJ",
			],
		},
		{
			name: "Latin America",
			codes: [
				"MX",
				"BR",
				"AR",
				"CL",
				"CO",
				"PE",
				"VE",
				"UY",
				"PY",
				"BO",
				"CR",
				"PA",
				"DO",
				"HN",
				"GT",
				"SV",
				"CU",
				"EC",
				"PR",
				"JM",
				"TT",
				"NI",
			],
		},
		{
			name: "South America",
			codes: ["AR", "BR", "CL", "CO", "PE", "VE", "UY", "PY", "BO", "EC", "GY", "SR"],
		},
		{
			name: "Eastern Europe",
			codes: [
				"RU",
				"UA",
				"LV",
				"RO",
				"PL",
				"HU",
				"BG",
				"CZ",
				"SK",
				"SI",
				"RS",
				"HR",
				"BA",
				"BY",
				"LT",
				"EE",
				"MD",
				"GE",
			],
		},
		{
			name: "Western Europe",
			codes: [
				"GB",
				"FR",
				"DE",
				"ES",
				"PT",
				"IT",
				"NL",
				"BE",
				"CH",
				"AT",
				"IE",
				"NO",
				"SE",
				"DK",
				"FI",
				"LU",
				"GR",
			],
		},
		{
			name: "Europe",
			codes: [
				"GB",
				"FR",
				"DE",
				"ES",
				"PT",
				"IT",
				"NL",
				"BE",
				"CH",
				"AT",
				"IE",
				"NO",
				"SE",
				"DK",
				"FI",
				"LU",
				"CZ",
				"PL",
				"HU",
				"RO",
				"BG",
				"RS",
				"HR",
				"SI",
				"SK",
				"UA",
				"LT",
				"LV",
				"EE",
				"GR",
				"MD",
				"GE",
			],
		},
		{
			name: "North America",
			codes: ["US", "CA", "MX"],
		},
	];

	async function load() {
		const stored=await chrome.storage.local.get(STORAGE_KEY);
		const parsed=stored[STORAGE_KEY];
		if(!parsed || parsed.schema!==2) return;
		config.blockedCountries=new Set((parsed.blockedCountries || []).filter(code=>Core.catalog.some(c=>c.type==="country" && c.id===code)));
		config.blockedRegions=new Set((parsed.blockedRegions || []).filter(value=>typeof value==="string" && value.length<=100));
		config.blockedLangs=new Set((parsed.blockedLangs || []).filter(value=>typeof value==="string" && value.length<20));
		config.filterMode=parsed.filterMode==="highlight"?"highlight":"block";
		config.highlightRegionDisplayOnly=parsed.highlightRegionDisplayOnly===true;
		config.filterTotals={...defaultTotals(),...(parsed.filterTotals || {}),session:0};
		config.analytics={...defaultAnalytics(),...(parsed.analytics || {})};
		config.knownUsers=Helpers.prune(parsed.knownUsers);
	}
	function snapshot() {
		config.knownUsers=Helpers.prune(config.knownUsers);
		config.countryDB={};
		for(const [user,entry] of Object.entries(config.knownUsers)) {
			if(entry.accountCountry) (config.countryDB[entry.accountCountry] ||= []).push(user);
		}
		return {schema:2,blockedCountries:[...config.blockedCountries],blockedRegions:[...config.blockedRegions],blockedLangs:[...config.blockedLangs],filterMode:config.filterMode,highlightRegionDisplayOnly:config.highlightRegionDisplayOnly,filterTotals:config.filterTotals,analytics:config.analytics,knownUsers:config.knownUsers};
	}
	function save() {
		clearTimeout(saveTimer);
		saveTimer=setTimeout(()=> {
			const data=structuredClone(snapshot());
			saveChain=saveChain.then(()=>chrome.storage.local.set({[STORAGE_KEY]:data})).catch(()=> {
				const el=document.getElementById("xcb-status");if(el) el.textContent="Could not save settings. Reopen X and try again.";
			});
		},250);
	}
	function exportDB() {return JSON.stringify(snapshot(),null,2);}
	function saveKnownToDB() {save();}
	function scheduleTotalsSave() {
		if(totalsSaveTimer) return;
		totalsSaveTimer=setTimeout(()=>{totalsSaveTimer=null;config.filterTotals.session=filteredCount;save();},1000);
	}


	for(const country of Core.catalog.filter(c=>c.type==="country")) {
		if(!COUNTRY_MAP[country.label]) COUNTRY_MAP[country.label]=country.id;
	}

	function normUser(u) {
		return Core.handle(u) || "";
	}

	function extractUsername(tweet) {
		const link =
			tweet.querySelector('div[data-testid="User-Name"] a[href]') ||
			tweet.querySelector('a[href*="/status/"]');
		if (!link) return null;

		let href = link.getAttribute("href") || "";
		if (/^https?:\/\//i.test(href)) {
			try {
				href = new URL(href).pathname;
			} catch (e) {
				/* ignore */
			}
		}
		const parts = href.split("/").filter(Boolean);
		if (!parts.length) return null;
		// Prefer the first non-reserved segment
		const candidate = parts[0];
		if (
			["i", "home", "explore", "notifications", "messages", "search"].includes(
				candidate,
			)
		)
			return null;
		return normUser(candidate);
	}

	function resolveCountryCode(input) {
		if (!input) return null;
		const raw = input.trim();
		if (!raw) return null;
		const upper = raw.toUpperCase();
		if (
			upper.length === 2 &&
			COUNTRY_MAP &&
			Object.values(COUNTRY_MAP).includes(upper)
		)
			return upper;
		// fuzzy by country name substring
		const found = Object.entries(COUNTRY_MAP).find(([name]) =>
			name.toLowerCase().includes(raw.toLowerCase()),
		);
		return found ? found[1] : null;
	}

	// ← everything else (fetch, hide, UI, scanning) is 100% identical to v5.0 above ←
	// (just copy the full body from the previous working script, only the config defaults changed)

	function hasBlockedLang(text) {
		if (!text) return false;
		for (const lang of config.blockedLangs)
			if (LANG_SCRIPTS[lang]?.test(text)) return lang;
		return false;
	}

	function countryCodeToFlag(code) {
		if (!code || typeof code !== "string" || code.length !== 2) return "";
		const upper = code.toUpperCase();
		const a = upper.charCodeAt(0) - 65 + 0x1f1e6;
		const b = upper.charCodeAt(1) - 65 + 0x1f1e6;
		if (a < 0x1f1e6 || b < 0x1f1e6) return "";
		return String.fromCodePoint(a, b);
	}

	function regionFromCountry(code) {
		if (!code) return null;
		const upper = code.toUpperCase();
		for (const def of REGION_DEFS) {
			if (def.codes.includes(upper)) return def.name;
		}
		return null;
	}

	function resolveRegionName(input) {
		if (!input) return null;
		const norm = input.trim().toLowerCase();
		if (!norm) return null;
		const found = REGION_DEFS.find(
			(def) => def.name.toLowerCase() === norm,
		);
		if (found) return found.name;
		return null;
	}

	function renderFlag(tweet, countryCode) {
		// Feature disabled: keep cleanup only
		const flagWrapId = tweet.dataset.xcbFlagId;
		if (flagWrapId) {
			const existing = document.getElementById(flagWrapId);
			if (existing) existing.remove();
			delete tweet.dataset.xcbFlagId;
		}
		return;
	}

	function flagPalette(code) {
		const c = (code || "").toUpperCase();
		const table = {
			US: { primary: "#b22234", secondary: "#3c3b6e" },
			CA: { primary: "#d52b1e", secondary: "#ffffff" },
			GB: { primary: "#c8102e", secondary: "#012169" },
			FR: { primary: "#0055a4", secondary: "#ef4135" },
			DE: { primary: "#000000", secondary: "#d00" },
			IT: { primary: "#009246", secondary: "#ce2b37" },
			ES: { primary: "#aa151b", secondary: "#f1bf00" },
			NL: { primary: "#ae1c28", secondary: "#21468b" },
			SE: { primary: "#006aa7", secondary: "#fecc00" },
			NO: { primary: "#ba0c2f", secondary: "#00205b" },
			FI: { primary: "#003580", secondary: "#ffffff" },
			DK: { primary: "#c8102e", secondary: "#ffffff" },
			RU: { primary: "#0039a6", secondary: "#d52b1e" },
			UA: { primary: "#0057b7", secondary: "#ffd700" },
			PL: { primary: "#dc143c", secondary: "#ffffff" },
			CN: { primary: "#de2910", secondary: "#ffde00" },
			JP: { primary: "#ffffff", secondary: "#bc002d" },
			KR: { primary: "#003478", secondary: "#c60c30" },
			AU: { primary: "#00247d", secondary: "#ff0000" },
			NZ: { primary: "#00247d", secondary: "#ff0000" },
			BR: { primary: "#009c3b", secondary: "#ffdf00" },
			MX: { primary: "#006341", secondary: "#ce1126" },
			AR: { primary: "#74acdf", secondary: "#f6b40e" },
			IN: { primary: "#ff9933", secondary: "#128807" },
			SA: { primary: "#006c35", secondary: "#ffffff" },
			IL: { primary: "#0038b8", secondary: "#ffffff" },
			IR: { primary: "#239f40", secondary: "#da0000" },
			TR: { primary: "#e30a17", secondary: "#ffffff" },
			ZA: { primary: "#007749", secondary: "#ffb612" },
			NG: { primary: "#008753", secondary: "#ffffff" },
			KE: { primary: "#006600", secondary: "#b22222" },
			EG: { primary: "#ce1126", secondary: "#000000" },
			ID: { primary: "#ce1126", secondary: "#ffffff" },
			PH: { primary: "#0038a8", secondary: "#ce1126" },
			SG: { primary: "#e0001b", secondary: "#ffffff" },
			TH: { primary: "#2d2a4a", secondary: "#a51931" },
			VN: { primary: "#da251d", secondary: "#ffde00" },
		};
		const entry = table[c] || table[(c || "").slice(0, 2)] || {
			primary: "#ff4d4f",
			secondary: "#ffffff",
		};
		return {
			primary: entry.primary,
			secondary: entry.secondary,
			shadow: `${entry.primary}55`,
			background: `${entry.secondary}1f`,
		};
	}

	function addFlagOverlay(tweet, countryCode) {
		if (!countryCode) return;
		const flag = countryCodeToFlag(countryCode);
		if (!flag) return;
		const existingId = tweet.dataset.xcbOverlayId;
		if (existingId) {
			const existing = document.getElementById(existingId);
			if (existing) existing.remove();
			delete tweet.dataset.xcbOverlayId;
		}
		const overlay = document.createElement("div");
		const id = `xcb-overlay-${Math.random().toString(36).slice(2, 9)}`;
		overlay.id = id;
		overlay.textContent = flag;
		overlay.style =
			"position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:220px;opacity:0.11;pointer-events:none;user-select:none;filter:saturate(0.9);z-index:1;overflow:hidden;line-height:1;";
		overlay.style.width = "100%";
		overlay.style.height = "100%";
		overlay.style.transform = "scale(1.1)";
		tweet.appendChild(overlay);
		tweet.dataset.xcbOverlayId = id;
	}

	function renderFooterInfo(tweet, countryCode, usernameChanges, regionName) {
		const rowId = tweet.dataset.xcbFooterId;
		const hasCountry = Boolean(countryCode);
		const hasChanges = Number.isFinite(usernameChanges);
		if (!hasCountry && !hasChanges && !regionName) {
			if (rowId) {
				const existing = document.getElementById(rowId);
				if (existing) existing.remove();
				delete tweet.dataset.xcbFooterId;
				delete tweet.dataset.xcbFooterContent;
			}
			return;
		}
		const parts = [];
		if (hasCountry) {
			const flag = countryCodeToFlag(countryCode) || countryCode;
			const fullName =
				Object.keys(COUNTRY_MAP).find(
					(name) => COUNTRY_MAP[name] === countryCode,
				) || countryCode;
			parts.push(`Account based in: ${flag} ${fullName}`);
		}
		if (!hasCountry && regionName) parts.push(`Account based in: ${regionName} (region only)`);
		if (hasChanges) {
			parts.push(`Username changes: ${usernameChanges}`);
		}
		const content = parts.join(" · ");
		if (!content) return;
		if (tweet.dataset.xcbFooterContent === content && rowId) {
			const existing = document.getElementById(rowId);
			if (existing) return;
		}
		const replyBtn = tweet.querySelector('[data-testid="reply"]');
		const actionGroup = replyBtn?.closest('div[role="group"]');
		const actionWrapper = actionGroup?.parentElement || actionGroup || tweet;
		let row = rowId ? document.getElementById(rowId) : null;
		if (!row) {
			row = document.createElement("div");
			const id = `xcb-footer-${Math.random().toString(36).slice(2, 9)}`;
			row.id = id;
			row.style =
				"display:flex;flex-wrap:wrap;gap:12px;padding:6px 12px 4px;margin-top:2px;font-size:12px;color:rgb(170,184,194);";
			tweet.dataset.xcbFooterId = id;
		}
		if (row.textContent !== content) row.textContent = content;
		tweet.dataset.xcbFooterContent = content;
		if (row.parentNode !== actionWrapper) {
			if (actionGroup && actionGroup.parentNode === actionWrapper) {
				actionWrapper.insertBefore(row, actionGroup.nextSibling);
			} else {
				actionWrapper.appendChild(row);
			}
		}
	}

	function recordSeen(countryCode, regionName, tweet) {
		if (!countryCode && !regionName) return;
		if (tweet?.dataset?.xcbSeenCounted) return;
		tweet.dataset.xcbSeenCounted = "1";
		config.analytics = config.analytics || defaultAnalytics();
		config.analytics.seenTotal = (config.analytics.seenTotal || 0) + 1;
		if (countryCode) {
			config.analytics.seenCountry[countryCode] =
				(config.analytics.seenCountry[countryCode] || 0) + 1;
		}
		if (regionName) {
			config.analytics.seenRegion[regionName] =
				(config.analytics.seenRegion[regionName] || 0) + 1;
		}
		scheduleTotalsSave();
	}

	async function fetchFollowingPage(cursor) {
		const host = window.location.host || "x.com";
		const url = `https://${host}/i/api/1.1/friends/list.json?count=200&skip_status=true&include_user_entities=false${
			cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
		}`;
		const resp = await fetch(url, {
			credentials: "include",
			headers: {
				"x-csrf-token": getCsrfToken(),
				authorization: `Bearer ${BEARER_TOKEN}`,
				"x-twitter-active-user": "yes",
				"x-twitter-auth-type": "OAuth2Session",
				"content-type": "application/json",
			},
		});
		if (resp.status === 429) {
			bridgeRetryAt = Math.max(bridgeRetryAt, nowTs() + RATE_LIMIT_BACKOFF_MS);
			bridgeState = "rate-limited"; updateLookupStatus();
			throw new Error("X rate limit");
		}
		if (!resp.ok) throw new Error("Following lookup unavailable");
		const body = await resp.json();
		return {
			users: (body.users || []).map((u) => normUser(u.screen_name || "")),
			next: body.next_cursor_str || null,
		};
	}

	async function fetchCountryInfo(user) {
		const value=await requestAbout(user);
		const info=Helpers.classify(value.country,REGION_DEFS.map(r=>r.name));
		config.knownUsers[user]={...info,usernameChanges:value.usernameChanges,ts:nowTs(),v:2};
		saveKnownToDB();
		return info.accountCountry;
	}


	async function analyzeFollowing(updateStatus) {
		if(followingBusy) return;
		followingBusy=true;
		const button=document.getElementById("xcb-following-scan");if(button) button.disabled=true;
		try {
			while(fetchBusy) await new Promise(resolve=>setTimeout(resolve,100));
			updateStatus("Fetching following list…");
			let cursor = null;
			const users = [];
			do {
				const { users: page, next } = await fetchFollowingPage(cursor);
				users.push(...page);
				cursor = next && next !== "0" ? next : null;
			} while (cursor && users.length < FOLLOW_SCAN_MAX);
			updateStatus(`Fetched ${users.length} accounts. Resolving countries…`);

			const summary = {};
			for (let i = 0; i < users.length; i += 1) {
				const u = users[i];
				let country = currentInfo(u)?.accountCountry || null;
				if (!country) {
					const wait=Math.max(0,nextFetchAllowed-nowTs(),bridgeRetryAt-nowTs());
					if(wait>60000) throw new Error("X lookup cooldown is active; try later");
					if(wait) await new Promise(resolve=>setTimeout(resolve,wait));
					country = await fetchCountryInfo(u);
					await new Promise((r) => setTimeout(r, FOLLOW_FETCH_DELAY));
				}
				if (!country) continue;
				if (!summary[country]) summary[country] = [];
				if (!summary[country].includes(u)) summary[country].push(u);
				updateStatus(
					`Resolved ${i + 1}/${users.length}… (${country} ${countryCodeToFlag(
						country,
					) || ""})`,
				);
			}

			const reportDiv = document.getElementById("xcb-following-report");
			if (reportDiv) {
				const entries = Object.entries(summary).sort(
					(a, b) => b[1].length - a[1].length,
				);
				reportDiv.innerHTML = entries
					.map(
						([code, list]) =>
							`<div style="margin:4px 0;"><strong>${countryCodeToFlag(code) || ""} ${
								Object.keys(COUNTRY_MAP).find(
									(name) => COUNTRY_MAP[name] === code,
								) || code
							}</strong> (${list.length}): ${list
								.slice(0, 30)
								.map(
									(u) =>
										`<a href="https://x.com/${u}" target="_blank" rel="noopener noreferrer" style="color:#1d9bf0;text-decoration:none;">@${u}</a>`,
								)
								.join(", ")}${list.length > 30 ? "…" : ""}</div>`,
					)
					.join("") || "No countries resolved.";
			}
			updateStatus("Following analysis complete.");
		} catch (e) {
			console.error("[XCB] analyzeFollowing failed", e);
			updateStatus("Following analysis stopped: X lookup unavailable or rate-limited. Try again later.");
		} finally {
			followingBusy=false;if(button) button.disabled=false;
			nextFetchAllowed=Math.max(nextFetchAllowed,nowTs()+FETCH_GAP_MS,bridgeRetryAt);
		}
	}

	function markChatFlag(container, user, countryCode) {
		if (!user || !countryCode) return;
		const flag = countryCodeToFlag(countryCode);
		if (!flag) return;
		const existingId = container.dataset.xcbChatFlagId;
		if (existingId) {
			const existing = document.getElementById(existingId);
			if (existing) return;
		}
		const nameSpan =
			container.querySelector("span:not([aria-hidden])") ||
			container.querySelector("span");
		if (!nameSpan) return;
		const badge = document.createElement("span");
		const id = `xcb-chat-flag-${Math.random().toString(36).slice(2, 9)}`;
		badge.id = id;
		badge.textContent = flag;
		badge.style =
			"margin-left:6px;font-size:14px;opacity:0.9;user-select:none;pointer-events:none;";
		nameSpan.insertAdjacentElement("afterend", badge);
		container.dataset.xcbChatFlagId = id;
	}

	function scanChatFlags() {
		if (!window.location.pathname.startsWith("/messages")) return;
		const targets = document.querySelectorAll(
			'div[data-testid="DMDrawer"] div[data-testid="User-Name"], div[data-testid="DMConversation"] div[data-testid="User-Name"], div[aria-label^="Conversation"] div[data-testid="User-Name"], div[data-testid="DMChat"] div[data-testid="User-Name"]',
		);
		targets.forEach((node) => {
			const userKey = extractUsername(node);
			if (!userKey) return;
			const info = currentInfo(userKey);
			const code = info?.accountCountry || null;
			if (code) {
				markChatFlag(node, userKey, code);
				recordSeen(code, info?.accountRegion || null, node);
			} else if (needsFetch(userKey)) {
				queueUser(userKey);
			}
		});
	}

	function updateFilteredDisplay() {
		const counterEl = document.getElementById("xcb-blocked-count");
		if (counterEl)
			counterEl.textContent = `Filtered this session: ${filteredCount} (${config.filterMode === "highlight" ? "highlight" : "block"}) | Total: ${
				config.filterTotals?.overall || 0
			}`;
	}

	function clearFilterMark(tweet) {
		const noteId = tweet.dataset.xcbNoteId;
		if (noteId) {
			const noteEl = document.getElementById(noteId);
			if (noteEl) noteEl.remove();
		}
		const badgeId = tweet.dataset.xcbBadgeId;
		if (badgeId) {
			const badgeEl = document.getElementById(badgeId);
			if (badgeEl) badgeEl.remove();
		}
		if (tweet.dataset.xcbPrevDisplay !== undefined) {
			tweet.style.display = tweet.dataset.xcbPrevDisplay;
			delete tweet.dataset.xcbPrevDisplay;
		} else if (tweet.dataset.xcbMode === "block") {
			tweet.style.removeProperty("display");
		}
		if (tweet.dataset.xcbPrevPosition !== undefined) {
			tweet.style.position = tweet.dataset.xcbPrevPosition;
			delete tweet.dataset.xcbPrevPosition;
		}
		const overlayId = tweet.dataset.xcbOverlayId;
		if (overlayId) {
			const overlayEl = document.getElementById(overlayId);
			if (overlayEl) overlayEl.remove();
			delete tweet.dataset.xcbOverlayId;
		}
		tweet.style.removeProperty("outline");
		tweet.style.removeProperty("outline-offset");
		tweet.style.removeProperty("box-shadow");
		tweet.style.removeProperty("background-color");
		delete tweet.dataset.xcbMode;
		delete tweet.dataset.xcbReason;
		delete tweet.dataset.blocked;
		delete tweet.dataset.xcbNoteId;
		delete tweet.dataset.xcbBadgeId;
	}

	function markBlocked(tweet, reason) {
		tweet.dataset.blocked = "1";
		tweet.dataset.xcbMode = "block";
		tweet.dataset.xcbReason = reason;
		tweet.dataset.xcbPrevDisplay = tweet.style.display || "";
		tweet.style.setProperty("display", "none", "important");
		const box = document.createElement("div");
		const noteId = `xcb-note-${Math.random().toString(36).slice(2, 9)}`;
		box.id = noteId;
		box.textContent = `Blocked: ${reason}`;
		box.style =
			"background:#000;color:#fff;padding:4px 8px;font-size:11px;border-radius:4px;margin:8px 0;";
		tweet.parentNode?.insertBefore(box, tweet);
		tweet.dataset.xcbNoteId = noteId;
		console.log("Blocked:", reason);
	}

	function markHighlighted(tweet, reason, countryCode) {
		tweet.dataset.xcbMode = "highlight";
		tweet.dataset.xcbReason = reason;
		const flag = countryCodeToFlag(countryCode);
		const displayText = flag
			? `${flag} ${countryCode || ""}`
			: reason.replace(/\+/g, " + ");
		const currentPos = getComputedStyle(tweet).position;
		if (currentPos === "static") {
			tweet.dataset.xcbPrevPosition = tweet.style.position || "";
			tweet.style.position = "relative";
		}
		const palette = flagPalette(countryCode);
		tweet.style.setProperty(
			"outline",
			`3px solid ${palette.primary}`,
			"important",
		);
		tweet.style.setProperty("outline-offset", "2px", "important");
		tweet.style.setProperty(
			"box-shadow",
			`0 0 0 3px ${palette.shadow}`,
			"important",
		);
		tweet.style.setProperty("background-color", palette.background, "important");

		const badge = document.createElement("div");
		const badgeId = `xcb-badge-${Math.random().toString(36).slice(2, 9)}`;
		badge.id = badgeId;
		badge.textContent = displayText;
		badge.style =
			"position:absolute;top:-10px;left:-10px;background:#ff4d4f;color:#fff;padding:6px 10px;border-radius:10px;font-size:12px;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:2;";
		tweet.appendChild(badge);
		tweet.dataset.xcbBadgeId = badgeId;
		addFlagOverlay(tweet, countryCode);
	}

	function markRegionOnlyHighlight(tweet, regionName) {
		if (tweet.dataset.xcbMode === "region-only") return;
		clearFilterMark(tweet);
		const currentPos = getComputedStyle(tweet).position;
		if (currentPos === "static") {
			tweet.dataset.xcbPrevPosition = tweet.style.position || "";
			tweet.style.position = "relative";
		}
		tweet.dataset.xcbMode = "region-only";
		tweet.dataset.xcbReason = `RegionOnly:${regionName}`;
		tweet.style.setProperty("outline", "3px solid #f5c400", "important");
		tweet.style.setProperty("outline-offset", "2px", "important");
		tweet.style.setProperty(
			"box-shadow",
			"0 0 0 3px rgba(245,196,0,0.35)",
			"important",
		);
		tweet.style.setProperty("background-color", "rgba(245,196,0,0.12)", "important");

		const badge = document.createElement("div");
		const badgeId = `xcb-badge-${Math.random().toString(36).slice(2, 9)}`;
		badge.id = badgeId;
		badge.textContent = `Region-only: ${regionName}`;
		badge.style =
			"position:absolute;top:-10px;left:-10px;background:#f5c400;color:#1c1c1c;padding:6px 10px;border-radius:10px;font-size:12px;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:2;";
		tweet.appendChild(badge);
		tweet.dataset.xcbBadgeId = badgeId;
	}

	function bumpCounts({ countryCode, lang }) {
		config.filterTotals = config.filterTotals || defaultTotals();
		if (countryCode) {
			blockStats.country[countryCode] =
				(blockStats.country[countryCode] || 0) + 1;
			config.filterTotals.country[countryCode] =
				(config.filterTotals.country[countryCode] || 0) + 1;
		}
		if (lang) {
			blockStats.lang[lang] = (blockStats.lang[lang] || 0) + 1;
			config.filterTotals.lang[lang] =
				(config.filterTotals.lang[lang] || 0) + 1;
		}
		if (arguments[0]?.region) {
			const region = arguments[0].region;
			blockStats.region[region] = (blockStats.region[region] || 0) + 1;
			config.filterTotals.region[region] =
				(config.filterTotals.region[region] || 0) + 1;
		}
		config.filterTotals.overall = (config.filterTotals.overall || 0) + 1;
		config.filterTotals.session = filteredCount;
	}

	function applyFilterAction(tweet, info) {
		const reason = info?.reason;
		const countryCode = info?.countryCode;
		const lang = info?.lang || null;
		const region = info?.region || null;
		const mode = config.filterMode === "highlight" ? "highlight" : "block";
		const prevMode = tweet.dataset.xcbMode;
		const prevReason = tweet.dataset.xcbReason;
		if (prevMode === mode && prevReason === reason) return;

		clearFilterMark(tweet);
		if (!reason) return;

		if (!tweet.dataset.xcbCounted) {
			filteredCount += 1;
			tweet.dataset.xcbCounted = "1";
			bumpCounts({ countryCode, lang, region });
			updateFilteredDisplay();
			scheduleTotalsSave();
		}

		if (mode === "highlight") {
			markHighlighted(tweet, reason, countryCode);
			return;
		}
		markBlocked(tweet, reason);
	}

	function parseProfileFromJson(obj) {
		return Helpers.parse(obj,REGION_DEFS.map(r=>r.name));
	}


	function getCsrfToken() {
		const match = document.cookie.match(/(?:^|; )ct0=([^;]+)/);
		return match ? match[1] : "";
	}

	function needsFetch(user) {
		return !!Core.handle(user) && (config.blockedCountries.size>0 || config.blockedRegions.size>0 || config.highlightRegionDisplayOnly) && !currentInfo(user);
	}
	function queueUser(user) {
		const u=normUser(user);
		if(needsFetch(u) && !config.pending.has(u) && !fetchQueue.includes(u) && fetchQueue.length<300) fetchQueue.push(u);
	}
	function fetchCountry(username) {
		const user=normUser(username);
		if(!needsFetch(user) || fetchBusy || followingBusy || config.pending.has(user) || nowTs()<Math.max(nextFetchAllowed,bridgeRetryAt)) return false;
		fetchBusy=true;config.pending.add(user);
		requestAbout(user).then(value=> {
			const info=Helpers.classify(value.country,REGION_DEFS.map(r=>r.name));
			config.knownUsers[user]={...info,usernameChanges:value.usernameChanges,ts:nowTs(),v:2};
			saveKnownToDB();safeScan();
		}).catch(()=> {
			// Do not cache transport/auth/endpoint failures as unknown locations.
		}).finally(()=> {
			config.pending.delete(user);fetchBusy=false;
			nextFetchAllowed=Math.max(nowTs()+FETCH_GAP_MS,bridgeRetryAt);
		});
		return true;
	}


	function scanAndHide() {
		document
			.querySelectorAll('article[data-testid="tweet"]')
			.forEach((tweet) => {
				const userKey = extractUsername(tweet);
				if (!userKey) return;
				const own=Core.handle(document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href")?.split("/")[1]);
				const statusLink=[...tweet.querySelectorAll('a[href]')].find(a=>a.querySelector("time") && new URL(a.href,location.origin).pathname.startsWith("/"+userKey+"/status/"));
				const postKey=userKey+":"+(statusLink?.getAttribute("href") || "");
				if(tweet.dataset.xcbPostKey!==postKey) {
					clearFilterMark(tweet);
					const footer=document.getElementById(tweet.dataset.xcbFooterId || "");if(footer) footer.remove();
					for(const key of ["xcbFooterId","xcbFooterContent","xcbCounted","xcbSeenCounted"]) delete tweet.dataset[key];
					tweet.dataset.xcbPostKey=postKey;
				}
				if(userKey===own) {clearFilterMark(tweet);return;}

				const text =
					tweet.querySelector('[data-testid="tweetText"]')?.textContent ||
					tweet.innerText ||
					"";
				const langMatch = hasBlockedLang(text);
				let reason = langMatch ? `Lang:${langMatch}` : "";
				const userInfo = currentInfo(userKey);
				const accountCountry = userInfo?.accountCountry || null;
				let countryCode = null;
				let regionName =
					userInfo?.accountRegion ||
					(userInfo?.accountCountry
						? regionFromCountry(userInfo.accountCountry)
						: null);
				if (userInfo?.accountRegion && !regionName)
					regionName = userInfo.accountRegion;
				if (
					userInfo &&
					accountCountry &&
					config.blockedCountries.has(accountCountry)
				) {
					countryCode = accountCountry;
					reason = reason
						? `${reason}+Country`
						: `Country:${accountCountry}`;
				}
				if (regionName && config.blockedRegions.has(regionName)) {
					reason = reason ? `${reason}+Region` : `Region:${regionName}`;
				}
				if (accountCountry || regionName) {
					recordSeen(accountCountry, regionName, tweet);
				}
				if (
					!userInfo ||
					(!userInfo.accountCountry &&
						(!userInfo.ts || nowTs() - userInfo.ts >= UNKNOWN_RETRY_MS))
				) {
					queueUser(userKey);
				}
				renderFlag(tweet, accountCountry || null);
				renderFooterInfo(tweet, accountCountry || null, userInfo?.usernameChanges, userInfo?.accountRegion);
				if (!reason && (tweet.dataset.xcbMode || tweet.dataset.blocked)) {
					clearFilterMark(tweet);
				}
				if (
					!reason &&
					config.highlightRegionDisplayOnly &&
					userInfo?.accountRegion &&
					!userInfo.accountCountry
				) {
					markRegionOnlyHighlight(tweet, regionName || userInfo.accountRegion);
					return;
				}
				if (reason)
					applyFilterAction(tweet, {
						reason,
						countryCode,
						lang: langMatch,
						region: config.blockedRegions.has(regionName || "")
							? regionName || null
							: null,
					});
			});
	}

	function processQueue() {
		updateLookupStatus();
		if(fetchBusy || followingBusy) return;
		const now = nowTs();
		if (now < Math.max(nextFetchAllowed,bridgeRetryAt)) return;
		let processed = 0;
		while (fetchQueue.length && processed < PREFETCH_BATCH) {
			const user = fetchQueue.shift();
			if (!needsFetch(user)) continue;
			const started = fetchCountry(user);
			if (!started) {
				// Put it back and wait for the next tick if throttled
				if (!config.pending.has(user)) fetchQueue.unshift(user);
				break;
			}
			processed += 1;
		}
	}

	// Sync removed: keep everything local only.

	function ensureSidebarButton(openModal) {
		const existing = document.getElementById("xcb-button");
		const nav = document.querySelector('nav[aria-label="Primary"]');
		if (!nav) return false;
		const homeLink = nav.querySelector('a[aria-label="Home"]');
		const profileLink = nav.querySelector('a[aria-label="Profile"]');
		const moreEntry =
			nav.querySelector('[aria-label="More menu items"]') ||
			nav.querySelector('[aria-label="More"]') ||
			nav.querySelector('[data-testid="AppTabBar_More_Menu"]');
		const anchorRef = moreEntry || profileLink || homeLink;
		if (!anchorRef) return false;
		const parent = (anchorRef.closest("a, div, button") || anchorRef).parentElement || nav;
		if (!parent) return false;
		const btn = existing || document.createElement("a");
		btn.id = "xcb-button";
		btn.setAttribute("role", "button");
		btn.href = "javascript:void(0)";
		btn.innerHTML =
			'<span class="xcb-icon" style="font-size:22px;line-height:22px;color:#fff;">🚫</span><span class="xcb-label" style="font-size:18px;font-weight:700;">CleanX</span>';
		btn.style =
			"display:flex;align-items:center;gap:14px;padding:12px;border-radius:9999px;color:#e7e9ea;text-decoration:none;font-size:17px;font-weight:700;cursor:pointer;max-width:260px;min-width:52px;box-sizing:border-box;";
		btn.onmouseenter = () => {
			btn.style.backgroundColor = "rgba(255,255,255,0.08)";
		};
		btn.onmouseleave = () => {
			btn.style.backgroundColor = "transparent";
		};
		btn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			openModal();
		};
		btn.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openModal();
			}
		};
		const label = btn.querySelector(".xcb-label");
		const updateLabelVisibility = () => {
			if (!label) return;
			label.style.display =
				(nav.getBoundingClientRect().width || 0) > 80 ? "inline" : "none";
		};
		updateLabelVisibility();
		if (typeof ResizeObserver !== "undefined") {
			const ro = new ResizeObserver(updateLabelVisibility);
			ro.observe(nav);
		} else {
			window.addEventListener("resize", updateLabelVisibility);
		}
		if (btn.parentElement !== parent) {
			if (moreEntry && moreEntry.parentElement === parent) {
				parent.insertBefore(btn, moreEntry);
			} else if (profileLink && profileLink.parentElement === parent) {
				parent.insertBefore(btn, profileLink.nextSibling);
			} else if (homeLink && homeLink.parentElement === parent) {
				parent.insertBefore(btn, homeLink.nextSibling);
			} else {
				parent.appendChild(btn);
			}
		}
		return true;
	}

	function injectUI() {
		if (document.getElementById("xcb-modal")) return;
		const modal = document.createElement("div");
		modal.id = "xcb-modal";
		modal.style =
			"display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;";
		modal.innerHTML = `<div style="background:#15202b;color:#fff;padding:20px;border-radius:12px;max-width:480px;width:92%;max-height:90vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,0.35);">
            <h2 style="margin:0 0 16px;text-align:center;">CleanX Local</h2>
            <div id="xcb-lookup-status" role="status" style="font-size:12px;color:#aab8c2;margin-bottom:10px;text-align:center;">Connecting to X…</div>
            <div style="font-size:13px;color:#aab8c2;margin-bottom:12px;text-align:center;">Uses X’s estimated account location. Broad region labels stay regions; unknown locations remain visible. Script filters match characters, not nationality. Counts: S = this session, T = total.</div>
            <div style="margin:10px 0 14px;">
              <strong>Filtered post behavior</strong>
              <div id="xcb-mode-row" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:13px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="xcb-mode" value="block" style="transform:scale(1.1);"> Block (hide)</label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="xcb-mode" value="highlight" style="transform:scale(1.1);"> Highlight with flag</label>
              </div>
            </div>
            <strong>Countries</strong><div id="list-c" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-c" placeholder="Add country (e.g. Israel or IL)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <strong>Regions</strong><div id="list-r" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-r" placeholder="Add region (e.g. Middle East and North Africa)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <strong>Writing scripts</strong><div id="list-l" style="max-height:200px;overflow:auto;margin:8px 0;padding:8px;background:#0002;border-radius:8px;"></div>
            <input id="add-l" placeholder="Add script filter (e.g. ar)" style="width:100%;padding:8px;margin:8px 0;border-radius:8px;">
            <div id="xcb-blocked-count" style="margin:8px 0;font-size:13px;color:#d9d9d9;">Filtered this session: 0</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:6px 0;"><input type="checkbox" id="xcb-highlight-region-only"> Highlight accounts showing region-only (yellow)</label>
            <div id="xcb-analytics" style="margin:10px 0;font-size:13px;color:#aab8c2;">Seen stats loading…</div>
            <button id="xcb-following-scan" style="width:100%;padding:10px;background:#273340;border:none;border-radius:8px;color:#fff;margin-top:8px;cursor:pointer;">Analyze Following (country breakdown)</button>
            <div id="xcb-following-status" style="margin:6px 0;font-size:12px;color:#aab8c2;"></div>
            <div id="xcb-following-report" style="max-height:180px;overflow:auto;padding:8px;background:#0002;border-radius:8px;font-size:12px;color:#e7e9ea;"></div>
            <button id="xcb-clear-cache" style="width:100%;padding:10px;background:#273340;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Refresh location cache</button>
            <button id="export-db" style="width:100%;padding:10px;background:#273340;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Export DB (JSON)</button>
            <button id="close" style="width:100%;padding:10px;background:#1d9bf0;border:none;border-radius:8px;color:#fff;margin-top:12px;cursor:pointer;">Close</button>
        </div>`;
		document.body.appendChild(modal);

		const statusLine = document.createElement("div");
		statusLine.id = "xcb-status";
		statusLine.style = "margin-top:8px;font-size:12px;color:#aab8c2;";
		modal.querySelector("div").appendChild(statusLine);

		updateFilteredDisplay();

		const setStatus = (msg) => {
			statusLine.textContent = msg || "";
		};

		modal
			.querySelectorAll('input[name="xcb-mode"]')
			.forEach((input) => {
				input.checked =
					input.value ===
					(config.filterMode === "highlight" ? "highlight" : "block");
				input.addEventListener("change", () => {
					if (!input.checked) return;
					config.filterMode =
						input.value === "highlight" ? "highlight" : "block";
					save();
					setStatus(
						config.filterMode === "highlight"
							? "Highlighting filtered posts with flags"
							: "Blocking filtered posts",
					);
					document
						.querySelectorAll('article[data-testid="tweet"]')
						.forEach((t) => clearFilterMark(t));
					safeScan();
					updateFilteredDisplay();
				});
			});

		const followScanBtn = document.getElementById("xcb-following-scan");
		const followStatus = document.getElementById("xcb-following-status");
		if (followScanBtn && followStatus) {
			followScanBtn.onclick = () => {
				if (followScanBtn.disabled) return;
				followScanBtn.disabled = true;
				followStatus.textContent = "Starting following analysis…";
				analyzeFollowing((msg) => {
					followStatus.textContent = msg;
				}).finally(() => {
					followScanBtn.disabled = false;
				});
			};
		}

		const regionOnlyToggle = document.getElementById("xcb-highlight-region-only");
		if (regionOnlyToggle) {
			regionOnlyToggle.checked = Boolean(config.highlightRegionDisplayOnly);
			regionOnlyToggle.addEventListener("change", () => {
				config.highlightRegionDisplayOnly = regionOnlyToggle.checked;
				save();
				setStatus(
					config.highlightRegionDisplayOnly
						? "Highlighting region-only accounts in yellow"
						: "Region-only highlighting disabled",
				);
				if (!config.highlightRegionDisplayOnly) {
					document
						.querySelectorAll('article[data-testid="tweet"]')
						.forEach((t) => {
							if (t.dataset.xcbMode === "region-only") clearFilterMark(t);
						});
				}
				safeScan();
			});
		}

		const refreshList = () => {
			const countryList = document.getElementById("list-c");
			countryList.innerHTML = "";
			Array.from(config.blockedCountries)
				.sort()
				.forEach((c) => {
					const row = document.createElement("div");
					row.id = `xcb-c-${c}`;
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.padding = "4px 0";
					row.innerHTML = `<span>${c} <span class="xcb-count" style="color:#aab8c2;">(S:${
						blockStats.country[c] || 0
					} | T:${config.filterTotals?.country?.[c] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
					row.lastChild.addEventListener("click", () => {
						config.blockedCountries.delete(c);
						save();
						refreshList();
						scanAndHide();
						setStatus(`Removed country ${c}`);
					});
					countryList.appendChild(row);
				});

			const regionList = document.getElementById("list-r");
			regionList.innerHTML = "";
			Array.from(config.blockedRegions)
				.sort()
				.forEach((r) => {
					const row = document.createElement("div");
					row.id = `xcb-r-${r}`;
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.padding = "4px 0";
					row.innerHTML = `<span>${r} <span class="xcb-count" style="color:#aab8c2;">(S:${
						blockStats.region[r] || 0
					} | T:${config.filterTotals?.region?.[r] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
					row.lastChild.addEventListener("click", () => {
						config.blockedRegions.delete(r);
						save();
						refreshList();
						scanAndHide();
						setStatus(`Removed region ${r}`);
					});
					regionList.appendChild(row);
				});

			const langList = document.getElementById("list-l");
			langList.innerHTML = "";
			Array.from(config.blockedLangs)
				.sort()
				.forEach((l) => {
					const row = document.createElement("div");
					row.id = `xcb-l-${l}`;
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.padding = "4px 0";
					row.innerHTML = `<span>${l} <span class="xcb-count" style="color:#aab8c2;">(S:${
						blockStats.lang[l] || 0
					} | T:${config.filterTotals?.lang?.[l] || 0})</span></span><span style="cursor:pointer;color:#f00;">×</span>`;
					row.lastChild.addEventListener("click", () => {
						config.blockedLangs.delete(l);
						save();
						refreshList();
						scanAndHide();
						setStatus(`Removed language ${l}`);
					});
					langList.appendChild(row);
				});

			const analyticsDiv = document.getElementById("xcb-analytics");
			if (analyticsDiv) {
				const topCountries = Object.entries(
					config.analytics?.seenCountry || {},
				)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 8)
					.map(
						([code, count]) =>
							`${countryCodeToFlag(code) || ""} ${code} (${count})`,
					)
					.join(", ");
				const topRegions = Object.entries(config.analytics?.seenRegion || {})
					.sort((a, b) => b[1] - a[1])
					.slice(0, 6)
					.map(([name, count]) => `${name} (${count})`)
					.join(", ");
				analyticsDiv.innerHTML = `<div style="margin-top:6px;">Seen (total): ${
					config.analytics?.seenTotal || 0
				}</div><div style="margin-top:4px;">Top countries: ${
					topCountries || "—"
				}</div><div style="margin-top:4px;">Top regions: ${
					topRegions || "—"
				}</div>`;
			}
		};

		const openModal = () => {
			modal.style.display = "flex";
			refreshList();
			updateFilteredDisplay();
		};
		const closeModal = () => (modal.style.display = "none");

		const placeButton = () => {
			if (!ensureSidebarButton(openModal)) setTimeout(placeButton, 700);
		};
		placeButton();
		modal.addEventListener("click", (e) => {
			if (e.target === modal) closeModal();
		});
		document.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
				e.preventDefault();
				openModal();
			}
			if (e.key === "Escape") closeModal();
		});
		document.getElementById("close").onclick = () => closeModal();
		updateLookupStatus();
		document.getElementById("xcb-clear-cache").onclick = () => {
			config.knownUsers=Object.create(null);config.countryDB={};save();safeScan();setStatus("Location cache cleared. Visible accounts will be checked again.");
		};
		document.getElementById("export-db").onclick = () => {
			setStatus("DB exported to console");
			console.log("XCB DB", exportDB());
		};
		document.getElementById("add-c").onkeydown = (e) => {
			if (e.key === "Enter") {
				const v = e.target.value.trim();
				const code = resolveCountryCode(v);
				if (!code) {
					setStatus(
						`Could not resolve "${v}". Try a 2-letter code or country name.`,
					);
					return;
				}
				config.blockedCountries.add(code);
				save();
				refreshList();
				scanAndHide();
				setStatus(`Added country ${code}`);
				e.target.value = "";
			}
		};
		document.getElementById("add-l").onkeydown = (e) => {
			if (e.key === "Enter") {
				const v = e.target.value.trim().toLowerCase();
				if (v) {
					config.blockedLangs.add(v);
					save();
					refreshList();
					scanAndHide();
					setStatus(`Added language ${v}`);
					e.target.value = "";
				}
			}
		};
		document.getElementById("add-r").onkeydown = (e) => {
			if (e.key === "Enter") {
				const v = e.target.value.trim();
				const resolved = resolveRegionName(v);
				if (!resolved) {
					setStatus(`Unknown region "${v}". Try a listed region name.`);
					return;
				}
				config.blockedRegions.add(resolved);
				save();
				refreshList();
				scanAndHide();
				setStatus(`Added region ${resolved}`);
				e.target.value = "";
			}
		};
	}

	function start() {
		const target = document.body || document.documentElement;
		if (!target) {
			document.addEventListener("DOMContentLoaded", start, { once: true });
			return;
		}
		const observer = new MutationObserver(() => {
			safeScan();
		});
		observer.observe(target, { childList: true, subtree: true });
		setInterval(safeScan, 4000);
		setInterval(processQueue, PREFETCH_INTERVAL_MS);
		setTimeout(() => {
			safeScan();
			processQueue();
			injectUI();
		}, 1500);
	}

	function safeScan() {
		try {
			scanAndHide();
			scanChatFlags();
		} catch (e) {
			console.error("scan error", e);
		}
	}

	load().then(()=> {
		postBridge({type:"config",active:true});start();
	}).catch(()=> {
		start();const show=()=> {const el=document.getElementById("xcb-status");if(el) el.textContent="Could not load saved settings.";};setTimeout(show,2000);
	});

	console.log(
		"CleanX Local 1.1 ready — nothing blocked until you add it",
	);
})();
