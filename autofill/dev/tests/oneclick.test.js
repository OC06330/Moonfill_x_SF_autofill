import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

// Layout in the merged Moonfill repo: autofill/ holds the extension code, autofill/dev/ the
// specification, mock pages and these tests. Paths below are relative to autofill/dev/.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const fullSpec = JSON.parse(read('field-specification.json'));
const spec = fullSpec.fields;
const fixed = spec.filter(f => !f.excluded && !f.rule);
const [fieldsJs, configJs, settingsJs, templatesJs, engineJs, contentJs] = ['fields.js', 'config.js', 'settings.js', 'templates.js', 'engine.js', 'content.js'].map(f => read('../' + f));

// A stand-in for the extension's chrome.storage.sync, permissions and runtime messaging.
// site(message) answers the panel's "read this site" requests, as the background script would.
function withChrome(saved, site = () => ({error: 'permission'})) {
  const store = saved ? {tcaSettings: saved} : {};
  const listeners = [];
  let granted = false;
  const chrome = {
    store, messages: [], usage: [], listeners: [],
    permissions: {
      contains: async () => granted,
      request: async () => (granted = true),
      remove: async () => !(granted = false)
    },
    storage: {
      sync: {
        get: async k => (k in store ? {[k]: store[k]} : {}),
        set: async o => { Object.assign(store, o); for (const l of listeners) l(Object.fromEntries(Object.keys(o).map(k => [k, {newValue: o[k]}])), 'sync'); }
      },
      onChanged: {addListener: l => listeners.push(l)}
    },
    runtime: {
      getURL: path => 'chrome-extension://test/' + path,
      // Usage records go to chrome.usage, so the site-reading assertions only see site requests.
      sendMessage: async message => {
        if (message.action === 'tcaUsage') { chrome.usage.push(message.event); return {ok: true}; }
        chrome.messages.push(message); return site(message);
      },
      onMessage: {addListener: l => chrome.listeners.push(l)}
    }
  };
  return chrome;
}

const MOCKS = {native: 'mock/technical-checklist.html', lightning: 'mock/lightning-record.html'};

async function open(mock, scenario = 'success', configure, chrome) {
  const path = MOCKS[mock];
  const dom = await JSDOM.fromFile(fileURLToPath(new URL(path, root)), {
    url: new URL(`${path}?scenario=${scenario}`, root).href,
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  const {window} = dom;
  if (chrome) window.chrome = chrome;
  window.eval(fieldsJs);
  window.eval(configJs);
  Object.assign(window.TCA_CONFIG, {timeouts: {editMode: 1000, dropdown: 600, save: 1500, readBack: 1000}, pollMs: 20});
  configure?.(window.TCA_CONFIG);
  window.eval(settingsJs);
  window.eval(templatesJs);
  window.eval(engineJs);
  window.eval(contentJs);
  await new Promise(r => setTimeout(r, 20)); // saved settings load
  opened.push(window);
  return window;
}

const opened = [];
afterEach(() => { for (const w of opened.splice(0)) w.close(); });

const panel = window => window.document.getElementById('tca-root').shadowRoot;

async function press(window, cls) {
  const ui = panel(window);
  ui.querySelector('.' + cls).click();
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 20));
    const status = ui.querySelector('.status');
    if (['saved', 'filled', 'failed', 'unconfirmed'].includes(status.dataset.state)) return status;
  }
  throw new Error('timed out');
}

// How each mock stores a date: the native page keeps the typed text, the Lightning one YYYY-MM-DD.
const stored = (mock, iso) => (mock === 'lightning' ? iso : iso.split('-').reverse().join('/'));

const key = (window, label, where = 'Technical Checklist') => {
  const rec = window.mockRecord;
  return rec[`${where}::${label}`] ?? rec[`${where === 'Technical Checklist' ? 'TC' : 'CC'}::${label}`];
};

test('extension field list is generated from the captured specification', async () => {
  const window = await open('native');
  assert.deepEqual(JSON.parse(JSON.stringify(window.TCA_FIELDS)), spec);
  window.close();
});

test('targets are the 28 fixed values plus the 2 date fields; 15 fields stay untouched', async () => {
  const window = await open('native');
  const {targets, excluded} = window.TCAEngine.planTargets(window.TCA_FIELDS);
  assert.equal(targets.length, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(targets.filter(t => t.rule).map(t => [t.label, t.rule]))), [['Pixel Sent', 'record-created-date'], ['Successful Tracking Test', 'today']]);
  assert.equal(excluded.length, 15);
  window.close();
});

test('dates are read in the formats Salesforce shows, day/month order from dateFormat', async () => {
  const window = await open('native');
  const {parseDate, formatDate} = window.TCAEngine;
  const uk = {dateFormat: 'DD/MM/YYYY'}, us = {dateFormat: 'MM/DD/YYYY'};
  for (const text of ['03/11/2026, 09:41', '3/11/2026', '03.11.2026', '03/11/26', '2026-11-03', '3 Nov 2026', '3 November 2026, 09:41', 'Nov 3, 2026']) {
    assert.equal(parseDate(text, uk), '2026-11-03', text);
  }
  assert.equal(parseDate('11/03/2026', us), '2026-11-03');
  assert.equal(parseDate('31/02/2026', uk), null, 'impossible date');
  assert.equal(parseDate('Created.', uk), null);
  assert.equal(formatDate('2026-11-03', 'DD/MM/YYYY'), '03/11/2026');
  window.close();
});

test('manifest: Moonfill entries unchanged; autofill added as its own content script and settings page', () => {
  const manifest = JSON.parse(read('../../manifest.json'));
  assert.equal(manifest.name, 'Moonfill');
  assert.deepEqual(manifest.content_scripts.slice(0, 2), [
    {matches: ['https://forms.office.com/*', 'https://forms.cloud.microsoft/*'], js: ['content.js']},
    {matches: ['https://awin.lightning.force.com/*'], js: ['salesforce.js']}
  ]);
  assert.deepEqual(manifest.content_scripts[2].js, ['fields.js', 'config.js', 'settings.js', 'templates.js', 'engine.js', 'content.js'].map(f => 'autofill/' + f));
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*'], 'reading client sites is optional, granted in Settings');
  assert.equal(manifest.host_permissions.length, 4, "Moonfill's own site access unchanged");
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.match(read('../../background.js'), /\ntry \{ importScripts\("autofill\/background\.js"\); \}/, "Moonfill's background loads the checklist's");
  assert.deepEqual(manifest.content_scripts[2].matches, ['https://awin.lightning.force.com/*', 'file:///*/autofill/dev/mock/*.html*']);
  assert.ok(manifest.permissions.includes('storage'));
  assert.equal(manifest.options_ui.page, 'autofill/options.html');
  assert.deepEqual(manifest.web_accessible_resources, [{resources: ['autofill/options.html'], matches: ['https://awin.lightning.force.com/*']}]);
});

test('settings: choices are applied over the team defaults; malformed or unknown ones are ignored', async () => {
  const window = await open('native');
  const {apply, clean} = window.TCASettings;
  const cfg = window.TCA_CONFIG;
  const saved = {
    dateFormat: 'MM/DD/YYYY',
    fields: {
      'Server to server': {mode: 'skip'},
      'Tech notes': {mode: 'value', value: '  Checked by me  '},
      'Successful Tracking Test': {mode: 'created'},
      'Img tag implemented': {mode: 'value', value: '   '},
      'Batch validation': {mode: 'nonsense'},
      'No such field': {mode: 'skip'}
    }
  };
  const {fields, cfg: out, changed} = apply(window.TCA_FIELDS, cfg, saved);
  const get = label => JSON.parse(JSON.stringify(fields.find(f => f.label === label)));
  assert.deepEqual(get('Server to server'), {label: 'Server to server', excluded: true, value: null});
  assert.deepEqual(get('Tech notes'), {label: 'Tech notes', excluded: false, value: 'Checked by me'});
  assert.equal(get('Successful Tracking Test').rule, 'record-created-date');
  assert.equal(get('Img tag implemented').value, 'Yes', 'blank custom value falls back to the team default');
  assert.equal(get('Batch validation').value, 'Yes');
  assert.equal(fields.length, 45);
  assert.equal(out.dateFormat, 'MM/DD/YYYY');
  assert.equal(cfg.dateFormat, 'DD/MM/YYYY', 'team config untouched');
  assert.equal(changed, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(clean({dateFormat: 'YYYY/DD', fields: 'x'}))), {});
});

test('settings: the panel fills with personal settings and says so', async () => {
  const chrome = withChrome({fields: {'Server to server': {mode: 'skip'}, 'Tech notes': {mode: 'value', value: 'Checked by me'}, 'Pixel Sent': {mode: 'today'}}});
  const window = await open('lightning', 'success', null, chrome);
  assert.match(panel(window).querySelector('.summary').textContent, /Fills 30 fields: 28 values and 2 dates\./);
  assert.match(panel(window).querySelector('.summary').textContent, /Your settings: 3 change\(s\)/);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(key(window, 'Server to server'), 'No', 'left untouched');
  assert.equal(key(window, 'Tech notes'), 'Checked by me', 'excluded field filled with a personal value');
  assert.equal(key(window, 'Pixel Sent'), window.TCAEngine.todayIso());
  assert.equal(key(window, 'Batch validation'), 'Yes', 'other fields keep the team default');
  const tabs = [];
  window.open = (url, target) => { tabs.push([url, target]); return null; };
  panel(window).querySelector('.settings').click();
  assert.deepEqual(tabs, [['chrome-extension://test/autofill/options.html', '_blank']]);
});

test('settings: changes saved while the page is open are used on the next run', async () => {
  const chrome = withChrome();
  const window = await open('native', 'success', null, chrome);
  assert.match(panel(window).querySelector('.summary').textContent, /Team defaults/);
  await chrome.storage.sync.set({tcaSettings: {fields: {'Server to server': {mode: 'skip'}}}});
  await new Promise(r => setTimeout(r, 20));
  assert.match(panel(window).querySelector('.summary').textContent, /Your settings: 1 change/);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(key(window, 'Server to server'), 'No');
});

async function openOptions(chrome) {
  const dom = await JSDOM.fromFile(fileURLToPath(new URL('../options.html', root)), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) { window.chrome = chrome; }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  await new Promise(r => setTimeout(r, 20));
  opened.push(dom.window);
  return dom.window;
}

test('settings page: lists all 45 fields, shows saved choices, saves only changes, resets', async () => {
  const chrome = withChrome({fields: {'Server to server': {mode: 'skip'}}});
  const window = await openOptions(chrome);
  const doc = window.document;
  const rows = [...doc.querySelectorAll('#fields tr')];
  assert.equal(rows.length, 45);
  const rowFor = label => rows.find(r => r.dataset.label === label);
  const modes = label => [...rowFor(label).querySelectorAll('option')].map(o => o.value);
  assert.equal(rowFor('Server to server').querySelector('.mode').value, 'skip');
  assert.ok(rowFor('Server to server').classList.contains('changed'));
  assert.equal(rowFor('Pixel Sent').querySelector('.default').textContent, 'Record creation date (only if empty)');
  assert.deepEqual(modes('Pixel Sent'), ['', 'skip', 'created', 'today'], 'date fields: date choices, no free text');
  assert.ok(!modes('Batch validation').includes('today'), 'no date choices on other fields');
  assert.ok(!modes('Tech notes').includes('skip'), 'no "leave untouched" where that is already the default');

  const choose = (label, mode, value) => {
    const r = rowFor(label), select = r.querySelector('.mode');
    select.value = mode;
    select.dispatchEvent(new window.Event('change'));
    if (value !== undefined) r.querySelector('.value').value = value;
  };
  choose('Tech notes', 'value');
  assert.equal(rowFor('Tech notes').querySelector('.value').hidden, false);
  doc.getElementById('save').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(doc.getElementById('status').textContent, /Enter a value for "Tech notes"/);

  choose('Tech notes', 'value', 'Checked by me');
  doc.getElementById('date-format').value = 'MM/DD/YYYY';
  doc.getElementById('save').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(doc.getElementById('status').textContent, /Saved\. 3 change/);
  assert.deepEqual(JSON.parse(JSON.stringify(chrome.store.tcaSettings)), {dateFormat: 'MM/DD/YYYY', fields: {'Server to server': {mode: 'skip'}, 'Tech notes': {mode: 'value', value: 'Checked by me'}}});

  doc.getElementById('reset').click();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(JSON.parse(JSON.stringify(chrome.store.tcaSettings)), {});
  assert.equal(rowFor('Server to server').querySelector('.mode').value, '');
  assert.equal(doc.getElementById('date-format').value, 'DD/MM/YYYY');
});

for (const mock of Object.keys(MOCKS)) {
  test(`${mock}: panel appears once and finds exactly the visible checklist`, async () => {
    const window = await open(mock);
    assert.equal(window.document.querySelectorAll('#tca-root').length, 1);
    assert.match(panel(window).querySelector('.found').textContent, /Technical Checklist found/);
    assert.equal(panel(window).querySelector('.save').disabled, false);
    window.close();
  });

  test(`${mock}: fill & save — all 28 fixed values and both dates; preserves excluded fields and other checklists`, async () => {
    const window = await open(mock);
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'saved', status.textContent);
    assert.equal(window.mockSaveCount, 1);
    for (const f of fixed) assert.equal(key(window, f.label), f.value, f.label);
    assert.equal(key(window, 'Server to server'), 'Yes', 'differing value replaced');
    assert.equal(key(window, 'Pixel Sent'), stored(mock, '2026-11-03'), 'creation date from Implementation History');
    assert.equal(key(window, 'Successful Tracking Test'), stored(mock, window.TCAEngine.todayIso()), "today's date");
    assert.equal(key(window, 'Tech notes'), 'Existing note from the implementer');
    assert.equal(key(window, 'Img tag implemented', 'Commercial Checklist'), 'No');
    window.close();
  });

  test(`${mock}: date fields that already have a value are kept`, async () => {
    const window = await open(mock, 'dates-filled');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'saved', status.textContent);
    assert.equal(key(window, 'Pixel Sent'), stored(mock, '2026-10-01'));
    assert.equal(key(window, 'Successful Tracking Test'), stored(mock, '2026-10-20'));
    assert.match(status.textContent, /Pixel Sent already had a value, so it was kept\. Successful Tracking Test already had a value/);
    window.close();
  });

  test(`${mock}: no "Created." line — Pixel Sent is left blank, the rest is saved and the panel says why`, async () => {
    const window = await open(mock, 'no-history');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'saved', status.textContent);
    assert.ok(!key(window, 'Pixel Sent'));
    assert.equal(key(window, 'Successful Tracking Test'), stored(mock, window.TCAEngine.todayIso()));
    assert.equal(key(window, 'Server to server'), 'Yes');
    assert.match(status.textContent, /Pixel Sent left as it is: no "Created\." line/);
    window.close();
  });

  test(`${mock}: Fill only changes the form but does not save`, async () => {
    const window = await open(mock);
    const status = await press(window, 'fill');
    assert.equal(status.dataset.state, 'filled', status.textContent);
    assert.ok(!window.mockSaveCount, 'not saved');
    assert.equal(key(window, 'Server to server'), 'No', 'record unchanged until the user saves');
    assert.ok(window.TCAEngine.isEditing(window.document, window.TCA_CONFIG), 'left in edit mode for review');
    window.close();
  });

  test(`${mock}: save validation error is reported as failure, not success`, async () => {
    const window = await open(mock, 'error');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'failed');
    assert.match(status.textContent, /did not save/);
    assert.equal(key(window, 'Server to server'), 'No');
    window.close();
  });

  test(`${mock}: missing dropdown option stops without saving and lists the options`, async () => {
    const window = await open(mock, 'missing-option');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'failed');
    assert.match(status.textContent, /Server to server.*not available.*Options shown: --None--, No, Exempt/);
    assert.ok(!window.mockSaveCount);
    window.close();
  });

  test(`${mock}: refuses to start when the record is already in edit mode`, async () => {
    const window = await open(mock);
    (window.document.getElementById('app') || window.document).querySelector('button[title^="Edit "]').click();
    const result = await window.TCAEngine.run(window.document, window.TCA_CONFIG, window.TCA_FIELDS);
    assert.equal(result.status, 'failed');
    assert.match(result.message, /already in edit mode/);
    window.close();
  });

  test(`${mock}: Check page reports labels and structure, changes nothing, contains no values`, async () => {
    const window = await open(mock);
    panel(window).querySelector('.check').click();
    await new Promise(r => setTimeout(r, 20));
    const report = panel(window).querySelector('textarea').value;
    assert.match(report, /Specification labels found: 45 of 45/);
    assert.match(report, /✓ Server to server · pencil: yes → will set "Yes"/);
    assert.match(report, /Implementation History: creation date found/);
    assert.match(report, /✓ Pixel Sent · pencil: yes → will set the record's creation date \(only if empty\)/);
    assert.doesNotMatch(report, /03\/11\/2026|2026-11-03/, 'no dates in the report');
    assert.doesNotMatch(report, /Existing note from the implementer|IMP-0001|Fictional Retailer/);
    assert.ok(!window.mockSaveCount);
    assert.ok(!window.TCAEngine.isEditing(window.document, window.TCA_CONFIG));
    window.close();
  });
}

test('native: duplicate Technical Checklist sections — fill disabled, engine refuses', async () => {
  const window = await open('native', 'duplicate');
  assert.equal(panel(window).querySelector('.save').disabled, true);
  const result = await window.TCAEngine.run(window.document, window.TCA_CONFIG, window.TCA_FIELDS);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /expected exactly one/);
  window.close();
});

test('lightning: hidden cached record is ignored; shadow-DOM picklists are filled', async () => {
  const window = await open('lightning');
  const titles = [...window.document.querySelectorAll('.test-id__section-header-title')].filter(t => t.textContent === 'Technical Checklist');
  assert.equal(titles.length, 2, 'mock has a hidden cached copy');
  assert.equal(window.TCAEngine.createdDate(window.document, window.TCA_CONFIG).date, '2026-11-03', "the cached record's history (2025) is ignored");
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  window.close();
});

test('lightning: a dependent field changing stops before Save', async () => {
  const window = await open('lightning', 'dependent');
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'failed', status.textContent);
  assert.match(status.textContent, /Deduplication Solution.*changed unexpectedly.*NOT saved/);
  assert.ok(!window.mockSaveCount);
  window.close();
});

test('lightning: Check page in edit mode reports control types', async () => {
  const window = await open('lightning');
  (window.document.getElementById('app') || window.document).querySelector('button[title^="Edit "]').click();
  panel(window).querySelector('.check').click();
  await new Promise(r => setTimeout(r, 20));
  const report = panel(window).querySelector('textarea').value;
  assert.match(report, /Server to server · pencil: no · control: picklist/);
  assert.match(report, /Deduplication Parameter · pencil: no · control: text/);
  assert.match(report, /Pixel Sent · pencil: no · control: text/);
  window.close();
});

test('lightning: a collapsed checklist is expanded, then filled and saved', async () => {
  const window = await open('lightning', 'collapsed');
  assert.match(panel(window).querySelector('.found').textContent, /Technical Checklist found/);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(key(window, 'Server to server'), 'Yes');
  window.close();
});

// ---------- Platform templates and detection ----------

const TEMPLATE_FIELDS = ['Deduplication Solution', 'Other Deduplication Solution', 'Tag Management Solution', 'eCommerce platform', 'Voucher Tracking implemented', 'Product Level Tracking implemented'];

// One small page per platform, each with at least one of its signs.
const SITES = {
  'BigCommerce': '<script src="https://cdn11.bigcommerce.com/s-abc/stencil/theme.js"></script><script>var BCData = {};</script>',
  'Lightspeed': '<link rel="stylesheet" href="https://cdn.webshopapp.com/shops/1234/themes/style.css">',
  'Magento': '<script type="text/x-magento-init">{"*":{"Magento_Ui/js/core/app":{}}}</script>',
  'OpenCart': '<a href="https://shop.test/index.php?route=product/category&path=20">Desktops</a><link href="catalog/view/theme/default/stylesheet/stylesheet.css">',
  'PrestaShop': '<script>var prestashop = {"cart":{}};</script><link href="/modules/ps_shoppingcart/ps_shoppingcart.css">',
  'Salesforce Commerce Cloud': '<form action="/on/demandware.store/Sites-Shop-Site/en_GB/Cart-AddProduct"></form>',
  'Shopify': '<link href="https://cdn.shopify.com/s/files/1/theme.css"><script>Shopify.theme = {"name":"Dawn"};</script>',
  'Shoplazza': '<script src="https://cdn.shoplazza.com/static/theme.js"></script>',
  'Shopware 5': '<link href="/web/cache/1700000000_abc.css"><script src="/themes/Frontend/Responsive/frontend/_public/src/js/jquery.plugin-base.js"></script>',
  'Shopware 6': '<link href="/bundles/storefront/assets/icon.svg"><script>window.router = {"frontend.checkout.cart.page": "/checkout/cart"};</script>',
  'Squarespace': '<link href="https://static1.squarespace.com/static/versioned-site-css/site.css"><script>Static.SQUARESPACE_CONTEXT = {};</script>',
  'Wix': '<img src="https://static.wixstatic.com/media/abc.jpg"><script src="https://static.parastorage.com/services/wix-bolt/app.js"></script>',
  'WooCommerce': '<body class="woocommerce-no-js"><link href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css"></body>'
};

test('templates: the 13 agreed platforms, only the six platform fields, exact values', async () => {
  const window = await open('native');
  const templates = JSON.parse(JSON.stringify(window.TCA_TEMPLATES));
  assert.deepEqual(templates, fullSpec.templates, 'fields.js matches the specification');
  assert.deepEqual(templates.map(t => t.name), Object.keys(SITES));
  for (const t of templates) assert.ok(Object.keys(t.values).every(l => TEMPLATE_FIELDS.includes(l)), t.name);
  const of = name => templates.find(t => t.name === name).values;
  assert.equal(of('BigCommerce')['Other Deduplication Solution'], 'BigCommerce plugin');
  assert.equal(of('BigCommerce')['eCommerce platform'], 'Bigcommerce');
  assert.ok(!('Other Deduplication Solution' in of('Magento')), 'Magento leaves Other Deduplication Solution untouched');
  assert.equal(of('Magento')['Deduplication Solution'], 'Magento');
  assert.equal(of('Shopify')['Voucher Tracking implemented'], 'Yes');
  assert.equal(of('Wix')['Product Level Tracking implemented'], 'No');
  assert.equal(of('Shopware 5')['eCommerce platform'], 'Shopware');
  assert.equal(of('WooCommerce')['eCommerce platform'], 'Wordpress (WooCommerce)');
  assert.ok(Object.keys(window.TCA_CONFIG.platformSigns).every(name => of(name)), 'every detectable platform has a template');
});

test('detection: each platform is recognised from its signs; nothing or a tie means no template', async () => {
  const window = await open('native');
  const {detect} = window.TCATemplates;
  const cfg = window.TCA_CONFIG;
  for (const [name, html] of Object.entries(SITES)) assert.equal(detect(html, cfg).name, name, name);
  assert.equal(detect('<html><body>Hello</body></html>', cfg).name, null);
  assert.match(detect('cdn.shopify.com static.wixstatic.com', cfg).reason, /signs of both/);
  assert.equal(detect(SITES.WooCommerce + '<script src="https://cdn.shopify.com/buy-button.js"></script> woocommerce_params', cfg).name, 'WooCommerce', 'a Shopify buy button on a WooCommerce shop');
  assert.equal(detect('x-wix-request-id: 123\n<html></html>', cfg).name, 'Wix', 'response headers count too');
});

test('templates: fill only empty fields, and personal settings still win', async () => {
  const window = await open('native');
  const {applyTemplate} = window.TCATemplates;
  const shopify = window.TCA_TEMPLATES.find(t => t.name === 'Shopify');
  const fields = JSON.parse(JSON.stringify(applyTemplate(window.TCA_FIELDS, shopify)));
  const get = label => fields.find(f => f.label === label);
  assert.deepEqual(get('Voucher Tracking implemented'), {label: 'Voucher Tracking implemented', excluded: false, value: 'Yes', onlyIfEmpty: true});
  assert.equal(get('eCommerce platform').excluded, false);
  assert.equal(get('Tech notes').excluded, true, 'other fields unchanged');
  const {fields: mine} = window.TCASettings.apply(applyTemplate(window.TCA_FIELDS, shopify), window.TCA_CONFIG, {fields: {'eCommerce platform': {mode: 'skip'}}});
  assert.equal(mine.find(f => f.label === 'eCommerce platform').excluded, true);
});

test('detection on Fill & save: Landing Page URL read, platform detected, template applied to empty fields only', async () => {
  const chrome = withChrome(null, () => ({ok: true, status: 200, text: SITES.Magento}));
  const window = await open('lightning', 'success', null, chrome);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.deepEqual(JSON.parse(JSON.stringify(chrome.messages)), [{action: 'tcaReadSite', url: 'https://shop.example.com/', via: 'fetch'}]);
  assert.match(status.textContent, /^Detected Magento: template applied\./);
  assert.equal(key(window, 'eCommerce platform'), 'Magento');
  assert.equal(key(window, 'Tag Management Solution'), 'Magento');
  assert.equal(key(window, 'Deduplication Solution'), 'Other', 'an existing answer is kept');
  assert.match(status.textContent, /Deduplication Solution already had a value, so it was kept/);
  assert.ok(!key(window, 'Other Deduplication Solution'), 'Magento leaves it untouched');
  assert.equal(key(window, 'Product Level Tracking implemented'), 'Yes', 'template replaces the default Unknown on an empty field');
  assert.equal(key(window, 'Server to server'), 'Yes', 'the rest of the default fill still happens');
});

test('detection: a blocked download is retried in a background tab', async () => {
  const chrome = withChrome(null, m => (m.via === 'fetch' ? {ok: false, status: 403, text: 'Access denied'} : {ok: true, status: 200, text: SITES.Shopify}));
  const window = await open('native', 'success', null, chrome);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.deepEqual(chrome.messages.map(m => m.via), ['fetch', 'tab']);
  assert.equal(chrome.messages[0].url, 'https://www.example-shop.com/', 'typed address without https:// is completed');
  assert.match(status.textContent, /^Detected Shopify/);
  assert.equal(key(window, 'Voucher Tracking implemented'), 'Yes');
  assert.equal(key(window, 'Other Deduplication Solution'), 'Shopify plugin');
});

test('detection: no platform found → default fill, with the reason', async () => {
  const chrome = withChrome(null, () => ({ok: true, status: 200, text: '<html>A custom shop</html>'}));
  const window = await open('lightning', 'success', null, chrome);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.deepEqual(chrome.messages.map(m => m.via), ['fetch', 'tab']);
  assert.match(status.textContent, /^No template: no platform signs found on the site, so the default fill was used\./);
  assert.equal(key(window, 'Voucher Tracking implemented'), 'Unknown', 'team default');
  assert.ok(!key(window, 'eCommerce platform'), 'left untouched without a template');
});

test('detection: not allowed yet → default fill and a pointer to Settings, without opening a tab', async () => {
  const chrome = withChrome();
  const window = await open('lightning', 'success', null, chrome);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.deepEqual(chrome.messages.map(m => m.via), ['fetch']);
  assert.match(status.textContent, /isn't allowed yet \(turn it on in Settings\)/);
});

test('detection: no Landing Page URL → default fill, nothing fetched', async () => {
  const chrome = withChrome(null, () => ({ok: true, status: 200, text: SITES.Wix}));
  const window = await open('native', 'no-landing', null, chrome);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(chrome.messages.length, 0);
  assert.match(status.textContent, /No template: no "Landing Page URL" field found on this record/);
});

test('template picker: a chosen platform is used without detection; "Default" uses no template', async () => {
  const chrome = withChrome(null, () => ({ok: true, status: 200, text: SITES.Shopify}));
  const window = await open('lightning', 'success', null, chrome);
  const picker = panel(window).querySelector('.template');
  assert.equal(picker.options.length, 16, 'auto, default, 13 platforms and Clear checklist');
  picker.value = 'Wix';
  picker.dispatchEvent(new window.Event('change'));
  let status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(chrome.messages.length, 0, 'no detection');
  assert.match(status.textContent, /^Wix template applied\./);
  assert.equal(key(window, 'Product Level Tracking implemented'), 'No');
  assert.equal(key(window, 'eCommerce platform'), 'Wix');
});

test('Check page reports the Landing Page URL and template without fetching anything', async () => {
  const chrome = withChrome(null, () => ({ok: true, status: 200, text: SITES.Shopify}));
  const window = await open('lightning', 'success', null, chrome);
  panel(window).querySelector('.check').click();
  await new Promise(r => setTimeout(r, 20));
  const report = panel(window).querySelector('textarea').value;
  assert.match(report, /Landing Page URL: found · template: auto-detect \(runs on Fill\)/);
  assert.doesNotMatch(report, /shop\.example\.com/, 'no values in the report');
  assert.equal(chrome.messages.length, 0);
});

test('settings page: platform detection can be allowed and turned off', async () => {
  const chrome = withChrome();
  const window = await openOptions(chrome);
  const doc = window.document;
  assert.match(doc.getElementById('detect-status').textContent, /Not allowed yet/);
  doc.getElementById('detect-toggle').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(doc.getElementById('detect-status').textContent, /^Allowed/);
  assert.equal(doc.getElementById('detect-toggle').textContent, 'Turn off');
  doc.getElementById('detect-toggle').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(doc.getElementById('detect-status').textContent, /Not allowed yet/);
});

// ---------- Background script (runs in the service worker) ----------

async function background({granted = true, fetchResult, tabHtml = '<html></html>'} = {}) {
  const {default: vm} = await import('node:vm');
  const calls = {created: [], removed: [], fetched: []};
  let listener, updated;
  const chrome = {
    runtime: {onMessage: {addListener: l => { listener = l; }}},
    permissions: {contains: async ({origins}) => { calls.origins = origins; return granted; }},
    tabs: {
      create: async o => { calls.created.push(o); setTimeout(() => updated(7, {status: 'complete'}), 5); return {id: 7}; },
      remove: async id => { calls.removed.push(id); },
      onUpdated: {addListener: l => { updated = l; }, removeListener: () => {}}
    },
    scripting: {executeScript: async o => { calls.script = o; return [{result: tabHtml}]; }}
  };
  const fetch = async (url, options) => { calls.fetched.push([url, options.credentials]); return fetchResult; };
  const context = vm.createContext({chrome, fetch, AbortController, URL, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)), clearTimeout, console});
  vm.runInContext(read('../background.js'), context);
  const ask = message => new Promise(resolve => { const async = listener(message, {}, resolve); if (async !== true) resolve('ignored'); });
  return {ask, calls};
}

test('background: reads a site invisibly with fetch, without cookies', async () => {
  const {ask, calls} = await background({fetchResult: {ok: true, status: 200, headers: [['x-powered-by', 'Shopware']], text: async () => '<html>shop</html>'}});
  const answer = await ask({action: 'tcaReadSite', url: 'https://www.example-shop.com/', via: 'fetch'});
  assert.equal(answer.ok, true);
  assert.match(answer.text, /^x-powered-by: Shopware\n<html>shop<\/html>$/);
  assert.deepEqual(calls.fetched, [['https://www.example-shop.com/', 'omit']]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.origins)), ['https://www.example-shop.com/*']);
});

test('background: the tab route opens an inactive tab, reads it and always closes it', async () => {
  const {ask, calls} = await background({tabHtml: '<html>window.Shopware</html>'});
  const answer = await ask({action: 'tcaReadSite', url: 'https://www.example-shop.com/', via: 'tab'});
  assert.equal(answer.text, '<html>window.Shopware</html>');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.created)), [{url: 'https://www.example-shop.com/', active: false}]);
  assert.equal(calls.script.target.tabId, 7);
  assert.deepEqual(calls.removed, [7]);
});

test('background: refuses without permission or a web address; ignores Moonfill messages', async () => {
  const {ask, calls} = await background({granted: false});
  assert.deepEqual(JSON.parse(JSON.stringify(await ask({action: 'tcaReadSite', url: 'https://x.example/'}))), {error: 'permission'});
  assert.deepEqual(JSON.parse(JSON.stringify(await ask({action: 'tcaReadSite', url: 'javascript:alert(1)'}))), {error: 'not a web address'});
  assert.equal(await ask({action: 'openForm', url: 'https://forms.office.com/x'}), 'ignored');
  assert.equal(calls.fetched.length + calls.created.length, 0);
});

// ---------- Usage reporting from the checklist panel ----------

test('usage: Fill & save records the Assigned TC, tool and success, and nothing about the client', async () => {
  const chrome = withChrome();
  const window = await open('lightning', 'success', null, chrome);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(chrome.usage.length, 1);
  const [event] = chrome.usage;
  assert.deepEqual([event.tool, event.action, event.outcome, event.tc], ['Checklist', 'fill-save', 'success', 'Alex Mock-Person']);
  // usage.js keeps only the reason's code, never the message itself.
  const {TCAUsage} = await usageModule();
  assert.equal(TCAUsage.row(chrome.usage[0], '0.7.0').Reason, '');
});

test('usage: a failed Fill only is recorded as failed with an empty Assigned TC', async () => {
  const chrome = withChrome();
  const window = await open('lightning', 'no-tc', null, chrome);
  const status = await press(window, 'fill');
  assert.equal(status.dataset.state, 'filled', status.textContent);
  const window2 = await open('lightning', 'missing-option', null, chrome);
  const failed = await press(window2, 'save');
  assert.equal(failed.dataset.state, 'failed');
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(chrome.usage.map(e => [e.action, e.outcome, e.tc]), [['fill', 'success', ''], ['fill-save', 'failed', 'Alex Mock-Person']]);
});

test('usage: the panel tells the background script the Assigned TC when asked', async () => {
  const chrome = withChrome();
  await open('lightning', 'success', null, chrome);
  let answer;
  chrome.listeners.forEach(l => l({action: 'tcaAssignedTc'}, {}, a => { answer = a; }));
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), {name: 'Alex Mock-Person'});
  const other = chrome.listeners.map(l => l({action: 'openForm'}, {}, () => assert.fail('answered a Moonfill message')));
  assert.deepEqual(other, [undefined]);
});

async function usageModule() {
  const {default: vm} = await import('node:vm');
  const context = vm.createContext({});
  vm.runInContext(read('../usage.js'), context);
  return context;
}

test('usage runs in the background: no Usage link on the panel, one plain line in Settings', async () => {
  const window = await open('lightning');
  assert.equal(panel(window).querySelector('.usage'), null);
  assert.deepEqual([...panel(window).querySelectorAll('button.link')].map(b => b.textContent), ['Settings']);
  const settings = await openOptions(withChrome());
  const text = settings.document.body.textContent;
  assert.match(text, /counts each use .* by the record's Assigned TC, to measure adoption\. No client information is recorded\./);
  assert.equal(settings.document.querySelector('a[href="usage.html"]'), null, 'no link to the dashboard');
});

// ---------- Clear checklist preset ----------

for (const mock of Object.keys(MOCKS)) {
  test(`${mock}: "Clear checklist" empties every field Fill fills, dates included, and leaves the rest`, async () => {
    const window = await open(mock);
    await press(window, 'save');                       // fill it first
    const ui = panel(window);
    ui.querySelector('.template').value = 'clear';
    ui.querySelector('.template').dispatchEvent(new window.Event('change'));
    assert.match(ui.querySelector('.summary').textContent, /^Clears 30 fields/);
    window.confirm = () => true;
    const before = window.mockSaveCount;
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'saved', status.textContent);
    assert.equal(window.mockSaveCount, before + 1);
    for (const f of fixed) assert.ok(!key(window, f.label), `${f.label} cleared`);
    assert.ok(!key(window, 'Pixel Sent') && !key(window, 'Successful Tracking Test'), 'dates cleared');
    assert.equal(key(window, 'Tech notes'), 'Existing note from the implementer', 'fields Fill leaves alone stay');
    assert.equal(key(window, 'Img tag implemented', 'Commercial Checklist'), 'No', 'other checklists stay');
  });
}

test('"Clear checklist" with Fill & save asks first; cancelling changes nothing', async () => {
  const window = await open('native');
  const ui = panel(window);
  ui.querySelector('.template').value = 'clear';
  ui.querySelector('.template').dispatchEvent(new window.Event('change'));
  let asked = '';
  window.confirm = text => { asked = text; return false; };
  ui.querySelector('.save').click();
  await new Promise(r => setTimeout(r, 50));
  assert.match(asked, /Clear 30 Technical Checklist fields and save the record\?/);
  assert.equal(window.mockSaveCount || 0, 0);
  assert.equal(ui.querySelector('.status').dataset.state, undefined);
});

