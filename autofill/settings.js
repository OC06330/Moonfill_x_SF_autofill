// Personal settings: each user can change what a field is filled with, on top of the team defaults in
// fields.js. Saved with chrome.storage.sync (follows the user's Edge profile). Shared by the panel
// (content.js) and the settings page (options.js). Classic script: exposes globalThis.TCASettings.
(function (root) {
  const KEY = 'tcaSettings';

  // A field choice: absent = team default; 'skip' = leave untouched; 'value' = fill with o.value;
  // 'created' / 'today' = the record's creation date / today's date (only if the field is empty).
  const MODES = ['skip', 'value', 'created', 'today'];
  const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY'];

  const storage = () => (root.chrome && root.chrome.storage && root.chrome.storage.sync) || null;

  // Saved settings, cleaned. {} when nothing is saved or storage isn't available (mock pages in tests).
  async function load() {
    const sync = storage();
    if (!sync) return {};
    try { return clean((await sync.get(KEY))[KEY]); } catch { return {}; }
  }

  async function save(settings) {
    const sync = storage();
    if (!sync) throw new Error('Settings storage is not available.');
    await sync.set({ [KEY]: clean(settings) });
  }

  // Drop anything malformed, so a bad saved value can never reach the engine.
  function clean(settings) {
    const out = {};
    if (!settings || typeof settings !== 'object') return out;
    if (DATE_FORMATS.includes(settings.dateFormat)) out.dateFormat = settings.dateFormat;
    const fields = {};
    for (const [label, o] of Object.entries(settings.fields || {})) {
      if (!o || !MODES.includes(o.mode)) continue;
      if (o.mode === 'value') {
        const value = String(o.value ?? '').trim();
        if (value) fields[label] = { mode: 'value', value };
      } else fields[label] = { mode: o.mode };
    }
    if (Object.keys(fields).length) out.fields = fields;
    return out;
  }

  // The field list and config to run with: team defaults with the user's choices applied.
  // Choices for labels no longer in the team list (e.g. a renamed field) are ignored.
  function apply(fields, cfg, settings) {
    const s = clean(settings);
    const choices = s.fields || {};
    const out = fields.map(f => {
      const o = choices[f.label];
      if (!o) return f;
      if (o.mode === 'skip') return { label: f.label, excluded: true, value: null };
      if (o.mode === 'value') return { label: f.label, excluded: false, value: o.value };
      return { label: f.label, excluded: false, value: null, rule: o.mode === 'today' ? 'today' : 'record-created-date', onlyIfEmpty: true };
    });
    const changed = fields.filter(f => choices[f.label]).length + (s.dateFormat && s.dateFormat !== cfg.dateFormat ? 1 : 0);
    return { fields: out, cfg: s.dateFormat ? { ...cfg, dateFormat: s.dateFormat } : cfg, changed };
  }

  // Plain-English description of what a field will be filled with.
  function describe(f) {
    if (f.excluded) return 'Leave untouched';
    if (f.rule === 'record-created-date') return 'Record creation date (only if empty)';
    if (f.rule === 'today') return "Today's date (only if empty)";
    return f.value;
  }

  // Watch for changes made on the settings page while a Salesforce tab is open.
  function onChange(callback) {
    const changed = root.chrome && root.chrome.storage && root.chrome.storage.onChanged;
    if (changed) changed.addListener((changes, area) => { if (area === 'sync' && changes[KEY]) callback(); });
  }

  root.TCASettings = { load, save, clean, apply, describe, onChange, DATE_FORMATS };
})(globalThis);
