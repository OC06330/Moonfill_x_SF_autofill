// Floating panel with Check page / Fill only / Fill & save for the Technical Checklist.
// The panel lives in its own shadow root on <body>, outside Salesforce's components, so Lightning
// re-renders can't remove it and SLDS styles can't leak in.
(function () {
  const teamCfg = globalThis.TCA_CONFIG;
  const teamFields = globalThis.TCA_FIELDS;
  const engine = globalThis.TCAEngine;
  const settings = globalThis.TCASettings;
  const templates = globalThis.TCA_TEMPLATES || [];
  const T = globalThis.TCATemplates;
  // Layers, last wins: team defaults → platform template (empty fields only) → the user's own settings.
  let saved = {};
  const effective = template => settings.apply(T.applyTemplate(teamFields, template), teamCfg, saved);
  let { fields, cfg, changed: personal } = effective(null);
  const refresh = async () => { saved = await settings.load(); ({ fields, cfg, changed: personal } = effective(null)); };
  // The "Clear checklist" preset: every field Fill would fill, emptied (dropdowns set to --None--).
  const clearing = () => state.template === 'clear';
  const clearFields = () => engine.planTargets(fields).targets.map(f => ({ label: f.label, excluded: false, value: '', clear: true }));
  const summary = () => {
    if (clearing()) return `Clears ${clearFields().length} fields: everything Fill fills, including the dates. v${cfg.version}`;
    const targets = engine.planTargets(fields).targets;
    return `Fills ${targets.length} fields: ${targets.filter(f => !f.rule).length} values and ${targets.filter(f => f.rule).length} dates. ` +
      (personal ? `Your settings: ${personal} change(s) from the team defaults.` : 'Team defaults.') + ` v${cfg.version}`;
  };

  const isMock = location.protocol === 'file:' && /\/mock\/[^/]+\.html$/.test(location.pathname);
  const isSalesforce = location.protocol === 'https:' && location.hostname === 'awin.lightning.force.com';
  if ((!isMock && !isSalesforce) || document.getElementById('tca-root')) return;

  const state = { running: false, ready: false, expanded: isMock, status: '', message: '', report: '', template: 'auto' };

  const host = document.createElement('div');
  host.id = 'tca-root';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px);
    background: #fff; color: #181818; border: 1px solid #c9c9c9; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.18);
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: 0; background: none; font: inherit; font-weight: 600; cursor: pointer; text-align: left; color: inherit; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #939393; flex: none; }
  .ready .dot { background: #2e844a; }
  .found { margin-left: auto; font-weight: 400; color: #5c5c5c; font-size: 12px; }
  .body { padding: 0 12px 12px; display: grid; gap: 8px; }
  .collapsed .body { display: none; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  button.act { padding: 5px 10px; border: 1px solid #0176d3; border-radius: 4px; background: #fff; color: #0176d3; font: inherit; font-weight: 600; cursor: pointer; }
  button.act.primary { background: #0176d3; color: #fff; }
  button.act:disabled { opacity: .5; cursor: default; }
  select { font: inherit; padding: 2px 4px; }
  .status:empty { display: none; }
  .status[data-state="saved"], .status[data-state="filled"] { color: #2e844a; }
  .status[data-state="failed"], .status[data-state="unconfirmed"] { color: #ba0517; font-weight: 600; }
  textarea { width: 100%; box-sizing: border-box; height: 160px; font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; }
  .report[hidden] { display: none; }
  .note { color: #5c5c5c; font-size: 12px; }
  button.link { margin-left: auto; padding: 5px 4px; border: 0; background: none; color: #0176d3; font: inherit; text-decoration: underline; cursor: pointer; }
</style>
<div class="panel collapsed">
  <button class="head" type="button" aria-expanded="false"><span class="dot"></span><span>Checklist Autofill</span><span class="found"></span></button>
  <div class="body">
    <div class="row"><label>Template <select class="template">
      <option value="auto">Auto-detect platform</option>
      <option value="none">Default (no template)</option>
      ${templates.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}
      <option value="clear">Clear checklist</option>
    </select></label></div>
    <div class="note summary"></div>
    <div class="row">
      <button class="act check" type="button">Check page</button>
      <button class="act fill" type="button">Fill only</button>
      <button class="act primary save" type="button">Fill &amp; save</button>
      <button class="link settings" type="button">Settings</button>
    </div>
    <div class="status" role="status" aria-live="polite"></div>
    <div class="report" hidden>
      <textarea readonly aria-label="Page check report"></textarea>
      <div class="row"><button class="act copy" type="button">Copy report</button><span class="note">Labels and page structure only, no field values.</span></div>
    </div>
  </div>
</div>`;

  const $ = sel => shadow.querySelector(sel);

  function paint() {
    $('.panel').classList.toggle('collapsed', !state.expanded);
    $('.panel').classList.toggle('ready', state.ready);
    $('.head').setAttribute('aria-expanded', String(state.expanded));
    $('.found').textContent = state.running ? 'working…' : state.ready ? `${cfg.checklistTitle} found` : 'checklist not found';
    for (const b of shadow.querySelectorAll('.fill, .save')) b.disabled = state.running || !state.ready;
    $('.check').disabled = state.running;
    $('.template').disabled = state.running;
    $('.summary').textContent = summary();
    const status = $('.status');
    if (state.status) status.dataset.state = state.status; else delete status.dataset.state;
    status.textContent = state.message;
    $('.report').hidden = !state.report;
    $('textarea').value = state.report;
  }

  function detect() {
    if (state.running) return;
    let ready = false;
    try { engine.findChecklist(document, cfg); ready = true; } catch { /* not on this page (yet) */ }
    if (ready && !state.ready && !state.seen) { state.expanded = true; state.seen = true; }
    if (ready !== state.ready) { state.ready = ready; paint(); }
  }

  // Ask the background script to read the client's site ('fetch' = invisibly, 'tab' = background tab).
  const readSite = (url, via) => Promise.resolve()
    .then(() => chrome.runtime.sendMessage({ action: 'tcaReadSite', url, via }))
    .then(answer => answer || { error: 'no answer' }, error => ({ error: error.message }));

  const say = message => { state.message = message; paint(); };

  // The template for this run: the one picked in the panel, or the detected platform's.
  // Anything unclear means no template (the default fill), with a note saying why.
  async function chooseTemplate(notes) {
    if (state.template === 'none' || clearing()) return null;
    if (state.template !== 'auto') return templates.find(t => t.name === state.template) || null;
    const site = engine.landingPageUrl(document, cfg);
    if (!site.url) { notes.push(`No template: ${site.reason}, so the default fill was used.`); return null; }
    say('Detecting the platform…');
    const page = await readSite(site.url, 'fetch');
    if (page.error === 'permission') { notes.push('No template: platform detection isn\'t allowed yet (turn it on in Settings), so the default fill was used.'); return null; }
    let found = page.ok ? T.detect(page.text, cfg) : { name: null, reason: page.error ? `the site couldn't be read (${page.error})` : `the site answered ${page.status}` };
    if (!found.name) {
      say('Checking the site in a background tab…');
      const tab = await readSite(site.url, 'tab');
      if (tab.ok) found = T.detect(tab.text, cfg);
    }
    if (!found.name) { notes.push(`No template: ${found.reason}, so the default fill was used.`); return null; }
    notes.push(`Detected ${found.name}: template applied.`);
    return templates.find(t => t.name === found.name) || null;
  }

  async function act(mode) {
    if (state.running) return;
    if (clearing() && mode === 'save' && !window.confirm(`Clear ${clearFields().length} Technical Checklist fields and save the record?`)) return;
    Object.assign(state, { running: true, status: 'running', message: mode === 'save' ? 'Filling and saving…' : 'Filling…', report: '' });
    paint();
    let result;
    const notes = [];
    try {
      await refresh();
      const template = await chooseTemplate(notes);
      if (template && state.template !== 'auto') notes.push(`${template.name} template applied.`);
      say(mode === 'save' ? 'Filling and saving…' : 'Filling…');
      const run = effective(template);
      if (clearing()) notes.push('Clear checklist:');
      result = await engine.run(document, run.cfg, clearing() ? clearFields() : run.fields, { mode });
    } catch (error) {
      result = { status: 'failed', message: `Unexpected error: ${error.message}` };
    }
    Object.assign(state, { running: false, status: result.status, message: [...notes, result.message].join(' ') });
    paint();
    detect();
    recordUsage(mode, result);
  }

  // Usage reporting: one record per Fill, sent to the background script. Only the outcome and a
  // reason code are kept from the result (usage.js turns the message into a code).
  function recordUsage(mode, result) {
    const ok = result.status === 'saved' || result.status === 'filled';
    const event = {
      tool: 'Checklist', action: mode === 'save' ? 'fill-save' : 'fill', outcome: ok ? 'success' : 'failed',
      reason: result.status === 'unconfirmed' ? 'unconfirmed' : result.message, tc: assignedTc()
    };
    Promise.resolve().then(() => chrome.runtime.sendMessage({ action: 'tcaUsage', event })).catch(() => {});
  }
  const assignedTc = () => { try { return engine.assignedTc(document, cfg); } catch { return ''; } };

  async function check() {
    let report;
    try {
      await refresh();
      const template = state.template === 'auto' ? 'auto-detect (runs on Fill)' : state.template === 'none' ? 'default (no template)' : state.template;
      report = engine.checkPage(document, cfg, fields, { pageType: isMock ? 'mock page' : 'Salesforce Lightning', personal, template });
    } catch (error) {
      report = `Page check failed: ${error.message}`;
    }
    Object.assign(state, { status: '', message: 'Check complete. Nothing was changed.', report });
    paint();
  }

  async function copy() {
    const area = $('textarea');
    try {
      await navigator.clipboard.writeText(area.value);
      state.message = 'Report copied.';
    } catch {
      area.select();
      state.message = 'Report selected: press Ctrl+C (⌘C on Mac) to copy.';
    }
    $('.status').textContent = state.message;
  }

  $('.head').addEventListener('click', () => { state.expanded = !state.expanded; paint(); });
  $('.check').addEventListener('click', check);
  $('.template').addEventListener('change', e => { state.template = e.target.value; paint(); });
  $('.fill').addEventListener('click', () => act('fill'));
  $('.save').addEventListener('click', () => act('save'));
  // Opened directly: the settings page is web-accessible on Salesforce only.
  const openPage = page => {
    try { window.open(chrome.runtime.getURL(`autofill/${page}`), '_blank'); } catch { state.message = 'Open Settings from edge://extensions → Moonfill → Details → Extension options.'; paint(); }
  };
  $('.settings').addEventListener('click', () => openPage('options.html'));
  // The background script asks for the record's Assigned TC when a Moonfill button is used here.
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.action === 'tcaAssignedTc') sendResponse({ name: assignedTc() });
      return undefined;
    });
  } catch { /* no extension messaging (tests) */ }
  settings.onChange(() => refresh().then(paint));

  (document.body || document.documentElement).appendChild(host);
  paint();
  refresh().then(paint);
  detect();
  setInterval(detect, 1500);
})();
