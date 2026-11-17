# Technical Checklist: developer notes

The code behind Moonfill's **Checklist Autofill** panel. For how to use it, see the main [README](../README.md#technical-checklist).

## How it fits into Moonfill

The checklist is loaded as its own content script on `awin.lightning.force.com`, alongside `salesforce.js`. The manifest also:
- registers its settings page (`options_ui`) and makes that page web-accessible on Salesforce only, so the panel's **Settings** link can open it directly
- declares `optional_host_permissions` for all websites, used only by platform detection and granted by the user in Settings

Moonfill's `background.js` gains one line at the end: `importScripts("autofill/background.js")`, wrapped so a failure can't stop Moonfill's own code. That file:
- answers `tcaReadSite` (platform detection)
- starts usage reporting (`usage.js`), which answers only `tcaUsage*` messages and *watches* Moonfill's `openForm`, `createNITabs` and `createIRTabs` without answering them Apart from that line and the manifest additions, the scan code (`background.js`, `salesforce.js`, `content.js`, the popup) is unchanged. It doesn't depend on the checklist code, and the checklist code doesn't depend on it.

- **Separate scope:** all checklist code runs inside its own function scope and exposes only `TCA_*` globals, so it shares no names with `salesforce.js` (content scripts of one extension share a page's isolated world).
- **Separate storage:** settings are saved with `chrome.storage.sync` under the key `tcaSettings`. The scan code uses `chrome.storage.local` and `session`, so neither touches the other's data.
- **Separate UI:** the panel is drawn in its own shadow root, so page styles and Moonfill's record buttons don't affect it.
- **Shared fields:** a scan writes five checklist fields (see [Fields filled by both](../README.md#fields-filled-by-both)). If a scan fills the record while the checklist runs, the checklist's before/after comparison spots the change and stops before Save.

## Files

| Path | Purpose |
| --- | --- |
| `fields.js` | The 45 field decisions and 13 platform templates, generated from `dev/field-specification.json` with `npm run generate`; a test keeps them identical |
| `config.js` | Date format, history box, Landing Page URL label, **platform signs**, page selectors, timeouts |
| `engine.js` | Find → expand → edit → check → fill → verify → save → read back; plus the read-only page check |
| `content.js` | The floating panel |
| `settings.js` | Loads, cleans and applies personal settings over the team defaults |
| `templates.js` | Applies a platform template (empty fields only) and detects the platform from a page's text |
| `usage.js` | Usage reporting: the record whitelist and reason codes, dashboard figures, and (in the worker) the queue, the SharePoint sender and the Moonfill hooks |
| `usage.html`, `usage-page.js` | The usage dashboard (not linked from the panel or Settings) |
| `background.js` | Reads a client's site for detection: invisible fetch without cookies, or an inactive tab that is always closed afterwards. Loaded by Moonfill's `background.js` |
| `options.html`, `options.js` | The settings page |
| `dev/field-specification.json` | The agreed field decisions (source of `fields.js`) |
| `dev/mock/` | Fictional record pages for testing. To use them in Edge, turn on **Allow access to file URLs** for the extension |
| `dev/tests/` | Tests run against the mock pages with jsdom |

```sh
cd autofill/dev
npm ci
npm test        # 64 tests
npm run generate  # after editing dev/field-specification.json
npm run check   # syntax check of autofill/*.js
```

## Taking upstream Moonfill updates

The `upstream` remote points at the original Moonfill repository (fetch only). The scan files are kept identical to it, so its updates merge cleanly. Only `manifest.json` (content scripts, settings page and optional permissions), the last line of `background.js` and `README.md` may need a hand merge.

```sh
git fetch upstream
git merge upstream/dev
```

## Platform detection

1. **Template choice.** On Fill, if the panel's template is **Auto-detect**, the panel reads the record's **Landing Page URL**. It prefers a link's address to its text and adds `https://` if missing.
2. **Reading the site.** The panel asks the background script to read the page, first with `fetch` (credentials omitted, 8 s timeout). If that fails, is blocked, or matches no platform, it tries an inactive tab: it waits for the page to load plus 1.5 s, reads the HTML and a few platform globals, then closes the tab.
3. **Matching.** `templates.js` counts each platform's signs (`config.platformSigns`, regular expressions over the HTML and response headers). The platform with the most signs wins. A tie, or no signs at all, means no template.
4. **Filling.** The template's values are layered onto the team defaults, filling empty fields only, and personal settings are applied on top.

The signs were checked against live public shops for Shopify, WooCommerce, BigCommerce, Squarespace and Wix (2026-11-16). For the other platforms they are unverified best guesses, so correct them in `config.js` if a site is detected wrongly.

## Usage reporting

**What a record holds.** `TCAUsage.row` builds every record from a whitelist:
- `When`, `AssignedTC`, `Tool`, `Action`, `Outcome`, `Reason`, `Version`
- Reasons are fixed codes (`REASONS` in `usage.js`). Error text is never kept, because Moonfill's messages can contain MIDs.
- Names keep only letters, spaces, `'`, `.` and `-`; anything else becomes "Unassigned".

**Who.** The record's **Assigned TC** (`config.assignedTcLabel`), read by `engine.assignedTc`.
- For the checklist, the panel reads it at the end of each run.
- For Moonfill's buttons, the worker asks the checklist content script in the sender's tab (`tcaAssignedTc`).
- For a scan, the person is kept locally by record ID (`tcaUsagePeople`, two days), so the result can be labelled when it arrives.

**Moonfill hooks, with no Moonfill file changed.** Moonfill's background functions are globals of the shared worker, so `usage.js` wraps two of them:
- `finishJob`: records each scan's done or failed
- `openTabGroup`: tells whether 🚀/🔎 opened their tabs

If an upstream update renames either one, that hook is skipped and clicks are still counted. To check, run `await TCAUsageWorker.status()` in the service worker console (edge://extensions → Moonfill → service worker). It shows the hooks, records waiting, and the last send or error.

**Sending.** Records queue in `chrome.storage.local` (`tcaUsageQueue`, newest 1000) and are sent when `config.usage.site` is set:
- First `POST /_api/contextinfo` for a digest, then one `POST …/getbytitle('<list>')/items` per record, with `credentials: 'include'` like Moonfill's own SharePoint reads.
- Unsent records retry on the next use and every 30 minutes.
- The dashboard reads the list through the worker, plus any records not sent yet.

**It runs in the background.** Nothing about it appears on the panel. Settings and the main README carry one plain line saying what's counted. The dashboard isn't linked anywhere: open `chrome-extension://<extension id>/autofill/usage.html` (the ID is on edge://extensions) and bookmark it. Anyone without full read access to the list gets SharePoint's refusal and sees only their own records that haven't been sent yet.

**Setting up the SharePoint list:**
1. On a SharePoint site the whole team can reach, create a list named `Plugin usage`.
2. Add these columns, named exactly like this, with no spaces: `AssignedTC`, `Tool`, `Action`, `Outcome`, `Reason`, `Version` (single line of text), and `When` (date and time). The display names can be changed afterwards.
3. Keep the list to yourself: as its owner, give the team **Contribute** access, then in **List settings → Advanced settings → Item-level permissions** choose *Read items that were created by the user* and *Create items and edit items that were created by the user*. The extension can then add everyone's rows, but only you can see them all.
4. Set `usage.site` in `config.js` to the site address, for example `https://zanox.sharepoint.com/teams/<team>`, then reload the extension.
5. Use the checklist once, and check that a row appears in the list.

Not yet verified: SharePoint accepting a POST from the extension (Moonfill only reads from SharePoint today). If it refuses, Settings shows the error and the records stay queued. The fallback would be a Power Automate HTTP flow.

## Origin

Ported from SalesforceAutofill v0.5.0, then extended here with platform templates and detection (v0.6.0), which exist only in this repository. Other differences from the standalone version:
- The Settings link opens the page directly, rather than messaging a background script.
- The tests check the combined manifest.
