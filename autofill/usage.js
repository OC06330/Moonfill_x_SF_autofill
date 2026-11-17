// Usage reporting: who used Moonfill (Assigned TC on the record) and how often, as success or failure.
// Classic script: exposes globalThis.TCAUsage. Loaded by the dashboard page and the background worker.
//
// Privacy: a usage record holds only the fields in ROW below. No MID, record ID, advertiser, URL or
// error text is ever kept: errors become a fixed reason code, and the name is reduced to letters.
// While config.usage.site is empty, records wait in this browser and nothing is sent anywhere.
(function (root) {
  const TOOLS = ['Checklist', 'Moonpull scan', 'New Implementation', 'IR'];
  const ACTIONS = ['fill', 'fill-save', 'scan', 'open-tabs'];
  const OUTCOMES = ['success', 'failed'];
  const ROW = ['When', 'AssignedTC', 'Tool', 'Action', 'Outcome', 'Reason', 'Version'];

  // Error text → reason code. First match wins; anything else is "other".
  const REASONS = [
    ['other', /^unexpected error/i],
    ['already-editing', /already in edit mode/i],
    ['save-error', /did not save/i],
    ['checklist-not-found', /section not found|sections; expected exactly one|couldn't expand/i],
    ['option-missing', /is not available|dropdown did not open/i],
    ['field-problem', /not found in the checklist|appears \d+ times|editable control|read-only|unsupported field type|unknown rule/i],
    ['value-not-kept', /did not keep its new value|don't show the expected value/i],
    ['page-changed', /changed unexpectedly|moved to another record|not on the expected record/i],
    ['edit-mode', /pencil|edit mode did not open|save button/i],
    ['scan-not-submitted', /form was not submitted/i],
    ['scan-timeout', /no result after/i],
    ['scan-mismatch', /result is for mid/i],
    ['scan-interrupted', /posting was interrupted|not brought to the front/i]
  ];
  // Plain-language names for the dashboard.
  const REASON_LABELS = {
    'other': 'Unexpected error',
    'already-editing': 'Record was already in edit mode',
    'save-error': 'Salesforce refused the save',
    'checklist-not-found': 'Checklist not found on the page',
    'option-missing': 'Dropdown option not available',
    'field-problem': "A field couldn't be filled",
    'value-not-kept': "A value didn't stick",
    'page-changed': 'Page changed during the run',
    'edit-mode': 'Edit mode or Save button problem',
    'unconfirmed': 'Save not confirmed',
    'scan-not-submitted': 'Scan form not submitted',
    'scan-timeout': 'No scan result in time',
    'scan-mismatch': 'Scan result was for another advertiser',
    'scan-interrupted': 'Posting the scan result was interrupted',
    'tabs-failed': "Tabs couldn't be opened"
  };
  const CODES = new Set(['unconfirmed', 'tabs-failed', 'other', ...REASONS.map(([code]) => code)]);

  function reasonCode(reason) {
    const text = String(reason ?? '').trim();
    if (!text) return 'other';
    if (CODES.has(text)) return text;
    const hit = REASONS.find(([, pattern]) => pattern.test(text));
    return hit ? hit[0] : 'other';
  }

  // A person's name as shown on the record, with anything that isn't part of a name removed.
  function person(name) {
    const clean = String(name ?? '').normalize('NFC').replace(/[^\p{L}\p{M}' .-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    return /\p{L}/u.test(clean) ? clean : 'Unassigned';
  }

  // One usage record from an event { tc, tool, action, outcome, reason }, or null if it isn't valid.
  function row(event, version, now = new Date()) {
    if (!event || !TOOLS.includes(event.tool) || !ACTIONS.includes(event.action) || !OUTCOMES.includes(event.outcome)) return null;
    return {
      When: now.toISOString(),
      AssignedTC: person(event.tc),
      Tool: event.tool,
      Action: event.action,
      Outcome: event.outcome,
      Reason: event.outcome === 'failed' ? reasonCode(event.reason) : '',
      Version: String(version ?? '').slice(0, 20)
    };
  }

  // ---------- Dashboard figures ----------

  // Monday of the record's week, as YYYY-MM-DD (UTC).
  function weekOf(iso) {
    const d = new Date(iso);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  function summarise(rows) {
    const total = rows.length;
    const failed = rows.filter(r => r.Outcome === 'failed').length;
    const tally = (key, of) => {
      const map = new Map();
      for (const r of rows) {
        const k = of(r);
        const t = map.get(k) || { key: k, success: 0, failed: 0, total: 0 };
        t[r.Outcome === 'failed' ? 'failed' : 'success']++;
        t.total++;
        map.set(k, t);
      }
      return [...map.values()];
    };
    const byTotal = (a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key));
    return {
      total, failed, success: total - failed,
      people: tally('person', r => r.AssignedTC || 'Unassigned').sort(byTotal),
      tools: tally('tool', r => r.Tool).sort(byTotal),
      reasons: tally('reason', r => r.Reason || 'other').filter(t => t.failed).sort((a, b) => b.failed - a.failed),
      weeks: tally('week', r => weekOf(r.When)).sort((a, b) => a.key.localeCompare(b.key)),
      table: tally('pair', r => `${r.AssignedTC}\u0000${r.Tool}`)
        .map(t => ({ person: t.key.split('\u0000')[0], tool: t.key.split('\u0000')[1], success: t.success, failed: t.failed, total: t.total }))
    };
  }

  // ---------- Background worker: queue, SharePoint sender, Moonfill hooks ----------

  const QUEUE = 'tcaUsageQueue';
  const STATUS = 'tcaUsageStatus';
  const PEOPLE = 'tcaUsagePeople';   // record ID → Assigned TC, kept locally to label a scan's result
  const MAX_QUEUE = 1000;
  const SEND_BATCH = 50;
  const JSON_TYPE = 'application/json;odata=nometadata';

  function startBackground({ chrome, fetch, cfg, global, version }) {
    const settings = cfg.usage || {};
    const site = () => String(settings.site || '').replace(/\/+$/, '');
    const items = () => `${site()}/_api/web/lists/getbytitle('${String(settings.list || '').replace(/'/g, "''")}')/items`;
    const local = chrome.storage.local;
    const get = async (key, fallback) => ((await local.get(key))[key] ?? fallback);

    // Every read-modify-write of the queue runs in turn, so two events can't overwrite each other.
    let chain = Promise.resolve();
    const serial = task => (chain = chain.then(task, task).catch(error => console.warn('Moonfill usage:', error)));

    async function setStatus(patch) {
      await local.set({ [STATUS]: { ...(await get(STATUS, {})), ...patch } });
    }

    async function sharepoint(url, options = {}) {
      const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...options, headers: { Accept: JSON_TYPE, ...(options.headers || {}) } });
      if (!res.ok) throw new Error(`SharePoint answered ${res.status}${res.status === 401 || res.status === 403 ? ' (sign in to SharePoint, or ask for access to the list)' : ''}`);
      return res;
    }

    async function send() {
      if (!site()) return;
      const queue = await get(QUEUE, []);
      if (!queue.length) return;
      let sent = 0;
      try {
        const digest = (await (await sharepoint(`${site()}/_api/contextinfo`, { method: 'POST' })).json()).FormDigestValue;
        for (const r of queue.slice(0, SEND_BATCH)) {
          await sharepoint(items(), {
            method: 'POST',
            headers: { 'Content-Type': JSON_TYPE, 'X-RequestDigest': digest },
            body: JSON.stringify({ Title: r.Tool, ...r })
          });
          sent++;
        }
        await setStatus({ lastSent: new Date().toISOString(), lastError: null });
      } catch (error) {
        await setStatus({ lastError: String(error.message || error), lastTried: new Date().toISOString() });
      } finally {
        if (sent) await local.set({ [QUEUE]: queue.slice(sent) });
      }
    }

    function add(event) {
      const r = row(event, version);
      if (!r) return Promise.resolve(false);
      return serial(async () => {
        const queue = await get(QUEUE, []);
        queue.push(r);
        await local.set({ [QUEUE]: queue.slice(-MAX_QUEUE) });
        await send();
      }).then(() => true);
    }

    async function readRows() {
      if (!site()) return { source: 'local', rows: await get(QUEUE, []) };
      const rows = [];
      let next = `${items()}?$select=${ROW.join(',')}&$top=5000`;
      for (let page = 0; next && page < 20; page++) {
        const data = await (await sharepoint(next)).json();
        rows.push(...(data.value || []).map(item => Object.fromEntries(ROW.map(k => [k, item[k] ?? '']))));
        next = data['odata.nextLink'] || data['@odata.nextLink'] || null;
      }
      return { source: 'sharepoint', rows: rows.concat(await get(QUEUE, [])) };
    }

    async function status() {
      return { configured: !!site(), site: site(), list: settings.list || '', waiting: (await get(QUEUE, [])).length, ...(await get(STATUS, {})) };
    }

    // The Assigned TC of the record open in a Salesforce tab, read by the checklist's content script.
    async function assignedTc(tabId) {
      if (tabId == null) return '';
      try { return ((await chrome.tabs.sendMessage(tabId, { action: 'tcaAssignedTc' })) || {}).name || ''; } catch { return ''; }
    }

    async function rememberPerson(recordId, name) {
      const people = await get(PEOPLE, {});
      const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
      people[recordId || ''] = { name, at: Date.now() };
      const kept = Object.entries(people).filter(([, p]) => p.at > cutoff).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
      await local.set({ [PEOPLE]: Object.fromEntries(kept) });
    }
    const personFor = async recordId => ((await get(PEOPLE, {}))[recordId || ''] || {}).name || '';

    // Moonfill hooks. Its files stay untouched: its background functions are globals of this worker,
    // so they're wrapped here. If an update renames one, that hook is skipped and nothing breaks.
    let pendingTabs = null;
    const hooks = { finishJob: false, openTabGroup: false };
    if (typeof global.openTabGroup === 'function') {
      const open = global.openTabGroup;
      global.openTabGroup = function (...args) {
        const result = open.apply(this, args);
        pendingTabs = Promise.resolve(result).then(() => 'success', () => 'failed');
        return result;
      };
      hooks.openTabGroup = true;
    }
    if (typeof global.finishJob === 'function') {
      const finish = global.finishJob;
      global.finishJob = async function (job, state, error, ...rest) {
        try {
          return await finish.call(this, job, state, error, ...rest);
        } finally {
          if (state === 'done' || state === 'failed') {
            personFor(job && job.recordId)
              .then(tc => add({ tool: 'Moonpull scan', action: 'scan', outcome: state === 'done' ? 'success' : 'failed', reason: error, tc }))
              .catch(() => {});
          }
        }
      };
      hooks.finishJob = true;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message) return undefined;
      const tabId = sender && sender.tab ? sender.tab.id : null;

      // Moonfill's own record buttons: only watched, never answered (Moonfill's handlers do that).
      if (message.action === 'openForm' && message.url) {
        assignedTc(tabId).then(name => serial(() => rememberPerson(message.recordId, name)));
        return undefined;
      }
      if (message.action === 'createNITabs' || message.action === 'createIRTabs') {
        const opened = pendingTabs;   // set by Moonfill's handler, which runs before this one
        pendingTabs = null;
        if (hooks.openTabGroup && !opened) return undefined;   // Moonfill opened nothing (no MID)
        Promise.all([assignedTc(tabId), opened || 'success']).then(([tc, outcome]) => add({
          tool: message.action === 'createNITabs' ? 'New Implementation' : 'IR',
          action: 'open-tabs', outcome, reason: 'tabs-failed', tc
        }));
        return undefined;
      }

      if (message.action === 'tcaUsage') { add(message.event).then(ok => sendResponse({ ok })); return true; }
      if (message.action === 'tcaUsageRows') {
        readRows().then(sendResponse, async error => sendResponse({ source: 'local', error: String(error.message || error), rows: await get(QUEUE, []) }));
        return true;
      }
      return undefined;
    });

    if (chrome.alarms) {
      chrome.alarms.create('tcaUsageSend', { periodInMinutes: 30 });
      chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'tcaUsageSend') serial(send); });
    }

    // For checking from the service worker console: await TCAUsageWorker.status()
    const api = { add, send: () => serial(send), readRows, status: async () => ({ ...(await status()), hooks }), hooks };
    global.TCAUsageWorker = api;
    return api;
  }

  root.TCAUsage = { TOOLS, ACTIONS, OUTCOMES, ROW, REASON_LABELS, reasonCode, person, row, weekOf, summarise, startBackground };
})(globalThis);
