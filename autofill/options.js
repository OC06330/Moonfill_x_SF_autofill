// Settings page: one row per field (team default + the user's choice), plus the date format.
(function () {
  const fields = globalThis.TCA_FIELDS;
  const cfg = globalThis.TCA_CONFIG;
  const S = globalThis.TCASettings;
  const $ = id => document.getElementById(id);

  const CHOICES = [
    ['', 'Team default'],
    ['skip', 'Leave untouched'],
    ['value', 'Fill with…'],
    ['created', 'Record creation date'],
    ['today', "Today's date"]
  ];

  function row(f) {
    const tr = document.createElement('tr');
    tr.dataset.label = f.label;
    const td = (cls, ...kids) => { const c = document.createElement('td'); c.className = cls; c.append(...kids); return c; };

    const select = document.createElement('select');
    select.className = 'mode';
    select.setAttribute('aria-label', `Your choice for ${f.label}`);
    // Date fields get date choices instead of free text (Salesforce reformats typed dates);
    // "leave untouched" only where the default fills something.
    for (const [mode, text] of CHOICES) {
      if ((mode === 'created' || mode === 'today') && !f.rule) continue;
      if (mode === 'value' && f.rule) continue;
      if (mode === 'skip' && f.excluded) continue;
      select.append(new Option(text, mode));
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value';
    input.setAttribute('aria-label', `Value for ${f.label}`);
    input.placeholder = f.value || 'Value, exactly as shown in Salesforce';
    const sync = () => { input.hidden = select.value !== 'value'; tr.classList.toggle('changed', select.value !== ''); };
    select.addEventListener('change', () => { sync(); if (select.value === 'value') input.focus(); status(''); });
    input.addEventListener('input', () => status(''));
    tr.append(td('label', f.label), td('default', S.describe(f)), td('choice', select, input));
    tr.sync = sync;
    return tr;
  }

  function show(settings) {
    $('date-format').value = settings.dateFormat || cfg.dateFormat;
    for (const tr of $('fields').children) {
      const o = (settings.fields || {})[tr.dataset.label];
      const select = tr.querySelector('.mode');
      select.value = o && [...select.options].some(opt => opt.value === o.mode) ? o.mode : '';
      tr.querySelector('.value').value = o && o.mode === 'value' ? o.value : '';
      tr.sync();
    }
  }

  function read() {
    const out = { fields: {} };
    if ($('date-format').value !== cfg.dateFormat) out.dateFormat = $('date-format').value;
    for (const tr of $('fields').children) {
      const mode = tr.querySelector('.mode').value;
      if (!mode) continue;
      if (mode === 'value') {
        const value = tr.querySelector('.value').value.trim();
        if (!value) throw new Error(`Enter a value for "${tr.dataset.label}", or choose another option.`);
        out.fields[tr.dataset.label] = { mode, value };
      } else out.fields[tr.dataset.label] = { mode };
    }
    return out;
  }

  function status(text, state) {
    $('status').textContent = text;
    if (state) $('status').dataset.state = state; else delete $('status').dataset.state;
  }

  async function save() {
    try {
      const settings = read();
      await S.save(settings);
      const n = Object.keys(settings.fields).length + (settings.dateFormat ? 1 : 0);
      status(n ? `Saved. ${n} change(s) from the team defaults.` : 'Saved. Using the team defaults.', 'ok');
    } catch (error) {
      status(error.message, 'error');
    }
  }

  async function reset() {
    show({});
    await save();
  }

  // Platform detection: the optional "read websites" permission, granted or removed here. request()
  // must run straight from the click (no await before it), or the browser refuses to ask.
  const SITES = { origins: ['https://*/*', 'http://*/*'] };
  const permissions = () => (globalThis.chrome && chrome.permissions) || null;
  async function showDetection() {
    const p = permissions();
    const button = $('detect-toggle');
    if (!p) { $('detect-status').textContent = 'Not available on this page.'; button.hidden = true; return; }
    const on = await p.contains(SITES);
    $('detect-status').textContent = on ? 'Allowed: Auto-detect reads the client\'s site when you click Fill.' : 'Not allowed yet: the default fill is used.';
    button.textContent = on ? 'Turn off' : 'Allow platform detection';
    button.dataset.on = String(on);
    button.hidden = false;
  }
  $('detect-toggle').addEventListener('click', () => {
    const p = permissions();
    const on = $('detect-toggle').dataset.on === 'true';
    (on ? p.remove(SITES) : p.request(SITES)).catch(() => false).then(showDetection);
  });
  showDetection();

  for (const format of S.DATE_FORMATS) $('date-format').append(new Option(format, format));
  $('date-format').addEventListener('change', () => status(''));
  $('fields').append(...fields.map(row));
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', reset);
  S.load().then(show);
})();
