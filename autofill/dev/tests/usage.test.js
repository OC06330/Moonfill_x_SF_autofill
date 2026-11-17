import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);      // autofill/
const read = path => readFileSync(new URL(path, root), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));

function usage() {
  const context = vm.createContext({});
  vm.runInContext(read('usage.js'), context);
  return context.TCAUsage;
}

// ---------- Records: only whitelisted, client-free fields ----------

test('a record keeps only the agreed columns; extra fields and error text never get in', () => {
  const U = usage();
  const r = U.row({tool: 'Moonpull scan', action: 'scan', outcome: 'failed', reason: 'result is for MID 12345, expected 67890. Nothing was posted',
    tc: 'Jane Smith', mid: '67890', recordId: 'a0X000', url: 'https://shop.example.com'}, '0.7.0', new Date('2026-11-17T10:42:00Z'));
  assert.deepEqual(plain(r), {When: '2026-11-17T10:42:00.000Z', AssignedTC: 'Jane Smith', Tool: 'Moonpull scan', Action: 'scan', Outcome: 'failed', Reason: 'scan-mismatch', Version: '0.7.0'});
  assert.deepEqual(Object.keys(r), plain(U.ROW));
  assert.doesNotMatch(JSON.stringify(r), /12345|67890|a0X000|example/);
});

test('reason codes: checklist and scan messages map to codes; unknown text becomes "other"', () => {
  const U = usage();
  const cases = {
    '"Server to server": option "Yes" is not available. Options shown: No.': 'option-missing',
    'Salesforce did not save: Required field missing.': 'save-error',
    '"Technical Checklist" section not found on this page. Is the Details tab open?': 'checklist-not-found',
    'The record is already in edit mode. Save or cancel your own edits first.': 'already-editing',
    '"Deduplication" changed unexpectedly, so nothing was saved.': 'page-changed',
    'no result after 6.5 minutes': 'scan-timeout',
    'the form was not submitted': 'scan-not-submitted',
    'Unexpected error: x is undefined.': 'other',
    'something new for advertiser 12345': 'other',
    unconfirmed: 'unconfirmed'
  };
  for (const [text, code] of Object.entries(cases)) assert.equal(U.reasonCode(text), code, text);
  for (const code of Object.keys(U.REASON_LABELS)) assert.equal(U.reasonCode(code), code, `${code} is a known code with a label`);
});

test('names: only letters survive; an empty or odd field is "Unassigned"; invalid events are dropped', () => {
  const U = usage();
  assert.equal(U.person('  Zoë  O\'Brien-Smith '), "Zoë O'Brien-Smith");
  assert.equal(U.person('Jane Smith 12345'), 'Jane Smith');
  assert.equal(U.person(''), 'Unassigned');
  assert.equal(U.person('0051234'), 'Unassigned');
  assert.equal(U.row({tool: 'Checklist', action: 'fill', outcome: 'maybe'}), null);
  assert.equal(U.row({tool: 'Something else', action: 'fill', outcome: 'success'}), null);
  assert.equal(U.row({tool: 'Checklist', action: 'fill', outcome: 'success', reason: 'Saved. 30 fields'}).Reason, '');
});

test('dashboard figures: per person, per tool, per reason, per week and the person × tool table', () => {
  const U = usage();
  const r = (When, AssignedTC, Tool, Outcome, Reason = '') => ({When, AssignedTC, Tool, Action: 'fill', Outcome, Reason, Version: '0.7.0'});
  const s = U.summarise([
    r('2026-11-16T09:00:00Z', 'Jane Smith', 'Checklist', 'success'),
    r('2026-11-17T09:00:00Z', 'Jane Smith', 'Checklist', 'failed', 'option-missing'),
    r('2026-11-18T09:00:00Z', 'Jane Smith', 'Moonpull scan', 'success'),
    r('2026-11-10T09:00:00Z', 'Sam Lee', 'Checklist', 'success')
  ]);
  assert.deepEqual([s.total, s.success, s.failed], [4, 3, 1]);
  assert.deepEqual(plain(s.people), [{key: 'Jane Smith', success: 2, failed: 1, total: 3}, {key: 'Sam Lee', success: 1, failed: 0, total: 1}]);
  assert.deepEqual(plain(s.tools.map(t => [t.key, t.total])), [['Checklist', 3], ['Moonpull scan', 1]]);
  assert.deepEqual(plain(s.reasons.map(t => [t.key, t.failed])), [['option-missing', 1]]);
  assert.deepEqual(plain(s.weeks.map(w => [w.key, w.total])), [['2026-11-09', 1], ['2026-11-16', 3]]);
  assert.equal(U.weekOf('2026-11-22T23:00:00Z'), '2026-11-16', 'Sunday belongs to the week starting Monday');
  assert.deepEqual(plain(s.table.find(t => t.person === 'Jane Smith' && t.tool === 'Checklist')), {person: 'Jane Smith', tool: 'Checklist', success: 1, failed: 1, total: 2});
});

// ---------- Background worker: Moonfill's worker plus autofill/background.js ----------

// A stand-in for Moonfill's background.js: the two functions the hooks wrap, and its own listeners.
const MOONFILL = `
  var calls = [];
  async function finishJob(job, state, error) { calls.push(['finishJob', job.id, state]); }
  async function openTabGroup(urls, title) { calls.push(['openTabGroup', title]); if (title === 'fail') throw new Error('no tabs'); }
  chrome.runtime.onMessage.addListener(msg => {
    if (msg && (msg.action === 'createNITabs' || msg.action === 'createIRTabs')) {
      if (!msg.mid) return;
      openTabGroup([], msg.mid).catch(() => {});
    }
  });
  async function aScanFinishes(job, state, error) { await finishJob(job, state, error); }
`;

function worker({site = '', fetchAnswers = [], tc = 'Jane Smith', moonfill = MOONFILL} = {}) {
  const store = {};
  const listeners = [];
  const fetched = [];
  const chrome = {
    runtime: {onMessage: {addListener: l => listeners.push(l)}},
    storage: {local: {
      get: async k => (k in store ? {[k]: structuredClone(store[k])} : {}),
      set: async o => { for (const [k, v] of Object.entries(o)) store[k] = structuredClone(v); }
    }},
    tabs: {sendMessage: async (tabId, m) => (m.action === 'tcaAssignedTc' && tabId === 3 ? {name: tc} : undefined)},
    permissions: {contains: async () => false},
    alarms: {create: () => {}, onAlarm: {addListener: () => {}}}
  };
  const fetch = async (url, options) => {
    fetched.push({url, method: options.method || 'GET', headers: options.headers, body: options.body && JSON.parse(options.body), credentials: options.credentials});
    const answer = fetchAnswers.length ? fetchAnswers.shift() : {status: 201, json: {}};
    return {ok: answer.status < 300, status: answer.status, json: async () => answer.json};
  };
  const context = vm.createContext({chrome, fetch, URL, AbortController, setTimeout, clearTimeout, console, structuredClone});
  context.importScripts = (...files) => { for (const f of files) vm.runInContext(read(f.replace(/^autofill\//, '')), context); };
  vm.runInContext(moonfill, context);
  context.importScripts('autofill/config.js', 'autofill/usage.js');   // as background.js would
  context.TCA_CONFIG.usage.site = site;
  vm.runInContext(read('background.js'), context);
  // Send a message the way Chrome does: every listener, in the order they were added.
  const send = (message, sender = {tab: {id: 3}}) => new Promise(resolve => {
    let async = false;
    for (const l of listeners) if (l(message, sender, resolve) === true) async = true;
    if (!async) resolve('unanswered');
  });
  return {context, store, fetched, send};
}

test('background: while SharePoint is not set up, uses wait in this browser silently and nothing is sent', async () => {
  const w = worker();
  assert.deepEqual(plain(await w.send({action: 'tcaUsage', event: {tool: 'Checklist', action: 'fill-save', outcome: 'success', tc: 'Jane Smith'}})), {ok: true});
  assert.equal(w.store.tcaUsageQueue.length, 1);
  assert.equal(w.store.tcaUsageQueue[0].Version, '1.0.0');
  assert.equal(w.fetched.length, 0);
  const status = await w.context.TCAUsageWorker.status();
  assert.equal(status.configured, false);
  assert.equal(status.waiting, 1);
  assert.deepEqual(plain(status.hooks), {finishJob: true, openTabGroup: true});
  const rows = await w.send({action: 'tcaUsageRows'});
  assert.equal(rows.source, 'local');
  assert.equal(rows.rows.length, 1);
});

test('background: with SharePoint set up, each use is sent with a digest and removed from the queue', async () => {
  const w = worker({site: 'https://zanox.sharepoint.com/teams/Test/', fetchAnswers: [{status: 200, json: {FormDigestValue: 'DIGEST'}}, {status: 201}]});
  await w.send({action: 'tcaUsage', event: {tool: 'Checklist', action: 'fill', outcome: 'failed', reason: 'Salesforce did not save: x', tc: 'Jane Smith'}});
  assert.deepEqual(w.fetched.map(f => [f.method, f.url, f.credentials]), [
    ['POST', 'https://zanox.sharepoint.com/teams/Test/_api/contextinfo', 'include'],
    ['POST', "https://zanox.sharepoint.com/teams/Test/_api/web/lists/getbytitle('Plugin usage')/items", 'include']
  ]);
  assert.equal(w.fetched[1].headers['X-RequestDigest'], 'DIGEST');
  assert.deepEqual(Object.keys(w.fetched[1].body), ['Title', 'When', 'AssignedTC', 'Tool', 'Action', 'Outcome', 'Reason', 'Version']);
  assert.equal(w.fetched[1].body.Reason, 'save-error');
  assert.equal(w.store.tcaUsageQueue.length, 0);
  assert.ok(w.store.tcaUsageStatus.lastSent);
});

test('background: if SharePoint refuses, the use is kept for later and the error is shown in Settings', async () => {
  const w = worker({site: 'https://zanox.sharepoint.com/teams/Test', fetchAnswers: [{status: 403}]});
  await w.send({action: 'tcaUsage', event: {tool: 'Checklist', action: 'fill', outcome: 'success', tc: 'Jane Smith'}});
  assert.equal(w.store.tcaUsageQueue.length, 1);
  assert.match(w.store.tcaUsageStatus.lastError, /SharePoint answered 403 \(sign in to SharePoint/);
});

test('background: the queue keeps the newest 1000 uses', async () => {
  const w = worker();
  w.store.tcaUsageQueue = Array.from({length: 1000}, (_, i) => ({When: `old-${i}`}));
  await w.send({action: 'tcaUsage', event: {tool: 'IR', action: 'open-tabs', outcome: 'success', tc: 'Jane Smith'}});
  assert.equal(w.store.tcaUsageQueue.length, 1000);
  assert.equal(w.store.tcaUsageQueue[0].When, 'old-1');
  assert.equal(w.store.tcaUsageQueue[999].Tool, 'IR');
});

test('background: Moonfill buttons are only watched; New Implementation and IR are recorded with the Assigned TC', async () => {
  const w = worker();
  assert.equal(await w.send({action: 'createNITabs', mid: '12345'}), 'unanswered', 'Moonfill messages are never answered');
  await w.send({action: 'createIRTabs', mid: 'fail'});
  await w.send({action: 'createNITabs', mid: ''});   // Moonfill opens nothing without a MID
  await tick();
  assert.deepEqual(plain(w.context.calls), [['openTabGroup', '12345'], ['openTabGroup', 'fail']]);
  assert.deepEqual(w.store.tcaUsageQueue.map(r => [r.Tool, r.Outcome, r.Reason, r.AssignedTC]), [
    ['New Implementation', 'success', '', 'Jane Smith'], ['IR', 'failed', 'tabs-failed', 'Jane Smith']
  ]);
  assert.doesNotMatch(JSON.stringify(w.store.tcaUsageQueue), /12345/);
});

test('background: a Moonpull scan is recorded when it finishes, with the Assigned TC from when it started', async () => {
  const w = worker();
  assert.equal(await w.send({action: 'openForm', url: 'https://forms.office.com/x', recordId: 'a0X1'}), 'unanswered');
  await tick();
  assert.equal(w.store.tcaUsagePeople.a0X1.name, 'Jane Smith', 'kept locally to label the result');
  await w.context.aScanFinishes({id: 'job1', recordId: 'a0X1'}, 'failed', 'no result after 6.5 minutes');
  await w.context.aScanFinishes({id: 'job2', recordId: 'a0X1'}, 'done');
  await w.context.aScanFinishes({id: 'job3', recordId: 'a0X1'}, 'posting');   // not finished: not recorded
  await tick();
  assert.deepEqual(plain(w.context.calls.map(c => c[2])), ['failed', 'done', 'posting'], "Moonfill's own finishJob still runs");
  assert.deepEqual(w.store.tcaUsageQueue.map(r => [r.Tool, r.Action, r.Outcome, r.Reason, r.AssignedTC]), [
    ['Moonpull scan', 'scan', 'failed', 'scan-timeout', 'Jane Smith'], ['Moonpull scan', 'scan', 'success', '', 'Jane Smith']
  ]);
  assert.doesNotMatch(JSON.stringify(w.store.tcaUsageQueue), /a0X1/);
});

test('background: if Moonfill renames its functions, the hooks are skipped and clicks are still counted', async () => {
  const w = worker({moonfill: 'chrome.runtime.onMessage.addListener(() => {});'});
  const status = await w.context.TCAUsageWorker.status();
  assert.deepEqual(plain(status.hooks), {finishJob: false, openTabGroup: false});
  await w.send({action: 'createNITabs', mid: '1'});
  await tick();
  assert.equal(w.store.tcaUsageQueue.length, 1);
  // Site reading still works alongside.
  assert.deepEqual(plain(await w.send({action: 'tcaReadSite', url: 'https://x.example/'})), {error: 'permission'});
});

// ---------- Dashboard page ----------

test('dashboard: totals, bars per person and tool, failure reasons and the table; filters redraw', async () => {
  const {JSDOM} = await import('jsdom');
  const {fileURLToPath} = await import('node:url');
  const row = (days, AssignedTC, Tool, Outcome, Reason = '') => ({When: new Date(Date.now() - days * 864e5).toISOString(), AssignedTC, Tool, Action: 'fill', Outcome, Reason, Version: '0.7.0'});
  const rows = [row(1, 'Jane Smith', 'Checklist', 'success'), row(2, 'Jane Smith', 'Checklist', 'failed', 'option-missing'),
    row(3, 'Sam Lee', 'Moonpull scan', 'success'), row(200, 'Old Person', 'IR', 'success')];
  const dom = await JSDOM.fromFile(fileURLToPath(new URL('usage.html', root)), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) { window.chrome = {runtime: {sendMessage: async m => (m.action === 'tcaUsageRows' ? {source: 'local', rows} : null)}}; }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  await tick(30);
  const doc = dom.window.document;
  const text = id => doc.getElementById(id).textContent;
  assert.equal(text('source'), 'This browser only');
  assert.deepEqual([text('k-total'), text('k-rate'), text('k-failed'), text('k-people')], ['3', '67%', '1', '2'], 'last 3 months by default');
  assert.deepEqual([...doc.querySelectorAll('#people .name')].map(n => n.textContent), ['Jane Smith', 'Sam Lee']);
  assert.equal(doc.querySelectorAll('#people .seg.failed').length, 1);
  assert.match(text('reasons'), /Dropdown option not available/);
  assert.equal(doc.querySelectorAll('#table tr').length, 2);
  doc.getElementById('period').value = 'all';
  doc.getElementById('period').dispatchEvent(new dom.window.Event('change'));
  assert.equal(text('k-people'), '3');
  doc.getElementById('tool').value = 'Checklist';
  doc.getElementById('tool').dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual([text('k-total'), text('k-rate')], ['2', '50%']);
  dom.window.close();
});
