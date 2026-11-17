// Checklist Autofill's part of the background service worker, loaded by Moonfill's background.js
// with importScripts. It reads a client's site for platform detection, on request from the panel:
//   { action: 'tcaReadSite', url, via: 'fetch' | 'tab' }  →  { ok, status, text } or { error }
// 'fetch' downloads the page invisibly; 'tab' opens it in an inactive tab, reads it once its scripts
// have run, then closes it. Both need the optional "read websites" permission, which the user grants
// once on the settings page. Nothing is sent anywhere: the text goes back to the panel only.
(function () {
  const LIMIT = 1500000;                  // characters of page text to keep
  const FETCH_TIMEOUT = 8000;
  const TAB_TIMEOUT = 15000;
  const TAB_SETTLE = 1500;                // let the page's scripts run after it loads

  const originOf = url => new URL(url).origin + '/*';

  async function viaFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: controller.signal });
      const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
      return { ok: res.ok, status: res.status, text: (headers + '\n' + (await res.text())).slice(0, LIMIT) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function viaTab(url) {
    const tab = await chrome.tabs.create({ url, active: false });
    try {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
        const onUpdated = (id, info) => { if (id === tab.id && info.status === 'complete') done(); };
        const timer = setTimeout(done, TAB_TIMEOUT);
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
      await new Promise(resolve => setTimeout(resolve, TAB_SETTLE));
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: limit => {
          const globals = ['Shopify', 'Shopware', 'BCData', 'prestashop', 'Mage', 'wixBiSession', 'Static', 'woocommerce_params', 'SHOPLAZZA']
            .filter(name => name in window).map(name => `window.${name}`).join(' ');
          return (document.documentElement.outerHTML + '\n' + globals).slice(0, limit);
        },
        args: [LIMIT]
      });
      return { ok: true, status: 200, text: (frame && frame.result) || '' };
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  async function readSite(message) {
    let url;
    try { url = new URL(message.url); } catch { return { error: 'not a web address' }; }
    if (!/^https?:$/.test(url.protocol)) return { error: 'not a web address' };
    if (!(await chrome.permissions.contains({ origins: [originOf(url.href)] }))) return { error: 'permission' };
    return message.via === 'tab' ? viaTab(url.href) : viaFetch(url.href);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaReadSite') return undefined;
    readSite(message).then(sendResponse, error => sendResponse({ error: String((error && error.message) || error) }));
    return true; // answers asynchronously
  });
})();

// Usage reporting (usage.js): queues "who used what" records and sends them to SharePoint once
// config.usage.site is set. Kept separate so a failure here can't affect site reading above.
try {
  if (typeof importScripts === 'function' && !globalThis.TCAUsage) importScripts('autofill/config.js', 'autofill/usage.js');
  const cfg = globalThis.TCA_CONFIG;
  if (globalThis.TCAUsage) globalThis.TCAUsage.startBackground({ chrome, fetch: (...args) => fetch(...args), cfg, global: globalThis, version: cfg.version });
} catch (error) {
  console.error('Moonfill usage reporting failed to start', error);
}
