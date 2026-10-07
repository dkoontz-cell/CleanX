# CleanX Local

Based on [theesfeld/CleanX](https://github.com/theesfeld/CleanX), upstream commit `80fd4db3400c432209ec63deab18952c9075631b` (2025-11-24). Git history is preserved and the original remote is named `upstream`. The personal fork is [dkoontz-cell/CleanX](https://github.com/dkoontz-cell/CleanX). Work is on `codex/local-hardening`.

This is a local modification of the **Chrome extension**. The upstream userscript is retained unchanged for reference and is not this modified release. The upstream README is retained as `UPSTREAM-README.md`.

## Load in Chrome

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and select this checkout’s `extension` folder.
3. Disable any other country-filter extension, then refresh your logged-in X tab.
4. Click the **CleanX** button in X’s left navigation. Add the countries/regions to filter. No locations are selected by default.
5. Start with **Highlight with flag** to inspect classifications; switch to **Block (hide)** when satisfied.

## Changes

- Exact country recognition. Broad `Account based in` region labels remain regions; unknown labels no longer become two-letter country codes.
- Confirmed countries and regions expire after 24 hours; empty results after 10 minutes. Maximum 2,000 cached authors. Old upstream cache records are not reused.
- Preferences, cached public labels, and statistics use `chrome.storage.local`, rather than X’s localStorage or IndexedDB. X page scripts cannot read the extension’s storage. No automatic migration of old site data.
- About-account credentials stay in page memory. No credentials are persisted or passed to the content script. The bridge observes X’s own authorization headers and sends only public location labels and username-change counts back.
- The bridge uses a known endpoint initially, inspects X’s already-loaded public bundle text for a current operation ID, and learns IDs from X’s own About-account requests. No downloaded JavaScript is executed.
- One location request at a time per tab; normal feed requests have a 3.5-second minimum gap. A 429 pauses for at least 15 minutes and respects longer Retry-After values. Errors stay visible in settings and do not become cached “unknown” results.
- Following analysis now uses the same location bridge, suspends feed lookups, and stops on errors rather than hammering an unavailable endpoint.
- Your own posts remain visible. Recycled timeline nodes reset filter/footer state. Region-only accounts show a region label instead of a made-up country flag.
- The settings panel includes a location-cache refresh button and a connection status line. Script filters are identified as writing-script filters: they match characters, not a verified language or nationality.

## Limits and verification

X’s endpoint is private and may change. If lookup fails, open any profile’s **Joined [date]** link to reach **About this account** in that tab, then return to the feed. Refresh X if the session is not connected. The extension leaves posts without known locations visible. Country data is X’s estimate of account operation, not nationality or account-creation country.

The page-world bridge does not protect against a malicious X page or another extension with X access; page messages can be imitated. It exposes no arbitrary-request operation and never returns credentials.

Use one X tab while populating the cache: throttling is per tab, and statistics/settings are saved by the active tab. The following-list feature still reads X’s same-origin friends API using its public web-client bearer and the page’s CSRF token. It never changes the account.

Run `node --test tests/*.test.cjs` from this checkout. Browser integration uses `node tests/browser.cjs` with Playwright and `BROWSER_EXECUTABLE` pointing to a Chromium browser. Tests fulfill all X responses locally and never use real account cookies. Live authenticated X compatibility still needs verification after installation.

## GitHub fork

The `origin` remote points to `https://github.com/dkoontz-cell/CleanX.git`; `upstream` points to the original project. The modified extension belongs on `codex/local-hardening`, leaving the fork’s `master` branch available for upstream synchronization.

Upstream does not include a license file in the reviewed checkout. Clarify licensing before distributing a packaged modified release.
