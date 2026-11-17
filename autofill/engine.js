// Check / fill / save engine for the Technical Checklist. Classic script (content scripts are not
// modules): exposes globalThis.TCAEngine. No network calls, no storage, no Salesforce API.
// Works on Salesforce Lightning record pages (best guess until verified) and on the bundled mocks.
(function (root) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^\*\s*/, '').replace(/\s*\*$/, '').trim().toLowerCase();

  class StopError extends Error {}

  async function waitFor(check, timeout, poll = 150) {
    const end = Date.now() + timeout;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() > end) return null;
      await sleep(poll);
    }
  }

  // ---------- DOM helpers that also look inside shadow roots (Lightning components) ----------

  function shadowOf(el) {
    try {
      const dom = root.chrome && root.chrome.dom;
      if (dom && dom.openOrClosedShadowRoot) return dom.openOrClosedShadowRoot(el) || null;
    } catch { /* not an extension context */ }
    return el.shadowRoot || null;
  }

  // All elements under node (including shadow trees) matching selector, in document order.
  function all(node, selector) {
    const out = [];
    const visit = scope => {
      for (const el of scope.querySelectorAll('*')) {
        if (el.matches(selector)) out.push(el);
        const shadow = shadowOf(el);
        if (shadow) visit(shadow);
      }
    };
    const own = node.nodeType === 1 && shadowOf(node);
    if (own) visit(own);
    visit(node);
    return out;
  }

  const parentOf = node => node.parentNode && node.parentNode.nodeType === 11 && node.parentNode.host ? node.parentNode.host : node.parentNode;

  function closest(el, selector) {
    for (let n = el; n; n = parentOf(n)) if (n.nodeType === 1 && n.matches(selector)) return n;
    return null;
  }

  function within(ancestor, el) {
    for (let n = el; n; n = parentOf(n)) if (n === ancestor) return true;
    return false;
  }

  // Rendered and not hidden. Salesforce keeps recently viewed records in the page, hidden.
  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility();
    for (let n = el; n && n.nodeType === 1; n = parentOf(n)) {
      if (n.hidden || (n.style && n.style.display === 'none')) return false;
    }
    return true;
  }

  // Visible text of el, skipping noise (asterisks, screen-reader text) and reading shadow content.
  function cleanText(el, noise) {
    let out = '';
    const visit = node => {
      const kids = node.nodeType === 1 && node.tagName === 'SLOT' && node.assignedNodes().length ? node.assignedNodes() : (node.nodeType === 1 && shadowOf(node) ? shadowOf(node) : node).childNodes;
      for (const c of kids) {
        if (c.nodeType === 3) out += c.data;
        else if (c.nodeType === 1 && !(noise && c.matches(noise)) && c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT') visit(c);
      }
    };
    visit(el);
    return out.replace(/\s+/g, ' ').trim();
  }

  const describe = el => el.tagName.toLowerCase() + [...el.classList].slice(0, 3).map(c => '.' + c).join('');

  // ---------- Finding the checklist and its fields ----------

  function planTargets(fields) {
    return { targets: fields.filter(f => !f.excluded), excluded: fields.filter(f => f.excluded).map(f => f.label) };
  }

  // ---------- Dates ----------

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const pad = n => String(n).padStart(2, '0');
  const monthOf = name => { const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase()); return i < 0 ? null : i + 1; };

  function isoDate(y, m, d) {
    y = Number(y) < 100 ? Number(y) + 2000 : Number(y); m = Number(m); d = Number(d);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  // The first date in text, as YYYY-MM-DD, or null. Reads 2026-11-03, 03/11/2026 (day/month order from
  // cfg.dateFormat), 3 Nov 2026 and Nov 3, 2026. Any time after the date is ignored.
  function parseDate(text, cfg) {
    const s = String(text ?? '');
    let m;
    if ((m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) return isoDate(m[1], m[2], m[3]);
    if ((m = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/))) {
      return cfg.dateFormat.indexOf('DD') < cfg.dateFormat.indexOf('MM') ? isoDate(m[3], m[2], m[1]) : isoDate(m[3], m[1], m[2]);
    }
    if ((m = s.match(/\b(\d{1,2})\.?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\b/)) && monthOf(m[2])) return isoDate(m[3], monthOf(m[2]), m[1]);
    if ((m = s.match(/\b([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/)) && monthOf(m[1])) return isoDate(m[3], monthOf(m[1]), m[2]);
    return null;
  }

  const formatDate = (iso, format) => { const [y, m, d] = iso.split('-'); return format.replace('YYYY', y).replace('MM', m).replace('DD', d); };
  const todayIso = () => { const t = new Date(); return isoDate(t.getFullYear(), t.getMonth() + 1, t.getDate()); };

  // The record's creation date from the "Created." line of its history box: { date } or { reason }.
  // Hidden content is read too (the box may sit on a tab that isn't showing), but only in the active record.
  function createdDate(doc, cfg) {
    const S = cfg.selectors;
    const { title, createdText } = cfg.history;
    const want = norm(title);
    const cards = [...new Set(all(activeRoot(doc, cfg), S.title)
      .filter(el => { const t = norm(cleanText(el, S.labelNoise)); return t === want || t.startsWith(want + ' ('); })
      .map(el => closest(el, S.historyCard)).filter(Boolean))];
    if (!cards.length) return { reason: `no "${title}" box found on this record. If it is on the Related tab, open that tab once, then come back to Details` };
    const created = new Set(createdText.map(norm));
    const rows = new Set();
    for (const card of cards) {
      for (const el of all(card, '*')) {
        if (!created.has(norm(cleanText(el, S.labelNoise)))) continue;
        const row = closest(el, S.historyRow);
        if (row && within(card, row)) rows.add(row);
      }
    }
    const dates = [...new Set([...rows].map(r => parseDate(cleanText(r, S.labelNoise), cfg)).filter(Boolean))];
    if (dates.length === 1) return { date: dates[0] };
    return { reason: dates.length ? `"${title}" shows ${dates.length} different creation dates` : `no "${createdText[0]}" line with a date in "${title}" (it may only show under View All)` };
  }

  // Target fields with their value worked out: fixed values as they are, date rules as a formatted date.
  // A creation date that can't be found leaves Pixel Sent out of the run, with a note saying why.
  function resolveTargets(doc, cfg, fields, notes) {
    let created = null;
    const out = [];
    for (const f of planTargets(fields).targets) {
      if (!f.rule || f.clear) { out.push(f); continue; }
      let date;
      if (f.rule === 'today') date = todayIso();
      else if (f.rule === 'record-created-date') {
        created = created || createdDate(doc, cfg);
        if (!created.date) { notes.push(`${f.label} left as it is: ${created.reason}.`); continue; }
        date = created.date;
      } else throw new StopError(`"${f.label}": unknown rule "${f.rule}".`);
      out.push({ ...f, date, value: formatDate(date, cfg.dateFormat) });
    }
    return out;
  }

  // Does text show this field's intended value? Dates compare as dates, whatever format Salesforce shows.
  // A field being cleared shows nothing (or --None--).
  const isBlank = text => ['', '--none--', '--none-'].includes(norm(text));
  const shows = (field, text, cfg) => (field.clear ? isBlank(text) : field.date ? parseDate(text, cfg) === field.date : norm(text) === norm(field.value));
  // The option a field's value picks: for a cleared field, the blank one.
  const picks = (field, text, value) => (field.clear ? isBlank(text) || value === '' : norm(text) === norm(field.value) || value === field.value);
  const describeRule = f => (f.rule === 'today' ? "today's date" : f.rule === 'record-created-date' ? "the record's creation date" : `"${f.value}"`) + (f.onlyIfEmpty ? ' (only if empty)' : '');

  function fieldItems(section, cfg) {
    const S = cfg.selectors;
    const seen = new Map();
    for (const labelEl of all(section, S.label)) {
      if (!visible(labelEl)) continue;
      let item = null;
      for (const sel of S.item) {
        const candidate = closest(labelEl, sel);
        if (candidate && within(section, candidate) && candidate !== section) { item = candidate; break; }
      }
      if (!item || seen.has(item)) continue;
      const label = cleanText(labelEl, S.labelNoise);
      if (label) seen.set(item, { item, label });
    }
    return [...seen.values()];
  }

  // The visible record page (Lightning keeps recently viewed records in the page, hidden).
  const activeRoot = (doc, cfg) => doc.querySelector(cfg.selectors.activeRoot) || doc;

  function checklistTitles(doc, cfg) {
    const want = norm(cfg.checklistTitle);
    return all(activeRoot(doc, cfg), cfg.selectors.title).filter(el => norm(cleanText(el, cfg.selectors.labelNoise)) === want);
  }

  const collapsedToggle = (section, cfg) => all(section, cfg.selectors.sectionToggle).find(b => b.getAttribute('aria-expanded') === 'false' && visible(b)) || null;

  // Exactly one visible section titled cfg.checklistTitle that contains fields (or is collapsed).
  function findChecklist(doc, cfg) {
    const S = cfg.selectors;
    const titles = checklistTitles(doc, cfg).filter(visible);
    const sections = [...new Set(titles.map(t => closest(t, S.section)).filter(s => s && visible(s) && (fieldItems(s, cfg).length || collapsedToggle(s, cfg))))];
    if (sections.length !== 1) {
      throw new StopError(sections.length ? `Found ${sections.length} "${cfg.checklistTitle}" sections; expected exactly one.` : `"${cfg.checklistTitle}" section not found on this page. Is the Details tab open?`);
    }
    return { section: sections[0], title: titles.find(t => within(sections[0], t)), collapsed: !fieldItems(sections[0], cfg).length };
  }

  // Expand the checklist if it is collapsed (a display toggle only; no data changes).
  async function expandChecklist(doc, cfg) {
    const found = findChecklist(doc, cfg);
    if (!found.collapsed) return found.section;
    collapsedToggle(found.section, cfg).click();
    const open = await waitFor(() => { try { const f = findChecklist(doc, cfg); return f.collapsed ? null : f.section; } catch { return null; } }, cfg.timeouts.editMode, cfg.pollMs);
    if (!open) throw new StopError(`Couldn't expand the "${cfg.checklistTitle}" section.`);
    return open;
  }

  function rowFor(section, cfg, label) {
    const rows = fieldItems(section, cfg).filter(r => norm(r.label) === norm(label));
    if (rows.length !== 1) throw new StopError(rows.length ? `"${label}" appears ${rows.length} times in the checklist.` : `"${label}" not found in the checklist.`);
    return rows[0].item;
  }

  function saveButtons(doc, cfg) {
    const S = cfg.selectors;
    const named = all(doc, S.saveButton).filter(visible);
    if (named.length) return named;
    return all(doc, S.saveFooter).flatMap(f => all(f, 'button')).filter(b => visible(b) && norm(b.textContent) === 'save');
  }
  const isEditing = (doc, cfg) => saveButtons(doc, cfg).length > 0;

  // ---------- Reading and writing one field ----------

  const optionText = (o, cfg) => {
    const truncated = all(o, '.slds-truncate')[0];
    return (truncated && truncated.getAttribute('title')) || cleanText(o, cfg.selectors.labelNoise);
  };

  function readAny(el, cfg) {
    if (el.matches(cfg.selectors.combobox)) return el.tagName === 'INPUT' ? el.value : cleanText(el, cfg.selectors.labelNoise);
    if (el.type === 'checkbox' || el.type === 'radio') return String(el.checked);
    if (el.tagName === 'SELECT') return el.selectedOptions[0] ? el.selectedOptions[0].text : '';
    return el.value;
  }

  // The single editable control in a field (edit mode). Throws if missing, ambiguous or unsupported.
  function controlFor(item, cfg, label) {
    const S = cfg.selectors;
    const combos = all(item, S.combobox).filter(visible);
    const natives = all(item, S.native).filter(visible);
    const count = combos.length + natives.length;
    if (count !== 1) {
      throw new StopError(count ? `"${label}": expected one editable control, found ${count}.` : `"${label}": no editable control (read-only, or a field type this version can't fill).`);
    }
    if (combos.length) return { kind: 'picklist', el: combos[0] };
    const el = natives[0];
    if (el.disabled || el.readOnly) throw new StopError(`"${label}" is read-only.`);
    if (el.tagName === 'SELECT') return { kind: 'select', el };
    if (el.tagName === 'TEXTAREA' || ['text', 'search', 'url', ''].includes(el.type)) return { kind: 'text', el };
    throw new StopError(`"${label}": unsupported field type (${el.type || el.tagName.toLowerCase()}).`);
  }

  function setNative(el, value) {
    const win = el.ownerDocument.defaultView;
    const proto = el.tagName === 'SELECT' ? win.HTMLSelectElement : el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement : win.HTMLInputElement;
    if (el.focus) el.focus();
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    for (const type of ['input', 'change']) el.dispatchEvent(new win.Event(type, { bubbles: true, composed: true }));
    el.dispatchEvent(new win.FocusEvent('blur'));
    el.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true, composed: true }));
  }

  function press(el, key) {
    const win = el.ownerDocument.defaultView;
    el.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
  }

  function clickLikeUser(el) {
    const win = el.ownerDocument.defaultView;
    for (const type of ['mousedown', 'mouseup']) el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, composed: true }));
    el.click();
  }

  // Open a Lightning picklist, choose the option whose text is value. Throws (dropdown closed) if absent.
  async function choosePicklist(control, item, cfg, field) {
    const S = cfg.selectors;
    const open = () => { const o = all(item, S.option).filter(visible); return o.length ? o : null; };
    let options = null;
    for (let attempt = 0; attempt < 2 && !options; attempt++) { // the first click is sometimes swallowed
      control.el.click();
      options = await waitFor(open, cfg.timeouts.dropdown / 2, cfg.pollMs);
      if (!options && control.el.getAttribute('aria-expanded') === 'true') control.el.click();
    }
    if (!options) throw new StopError(`"${field.label}": the dropdown did not open.`);
    const texts = options.map(o => optionText(o, cfg));
    const matches = options.filter((o, i) => picks(field, texts[i], o.getAttribute('data-value')));
    if (matches.length !== 1) {
      press(control.el, 'Escape');
      if (control.el.isConnected && control.el.getAttribute('aria-expanded') === 'true') control.el.click();
      throw new StopError(`"${field.label}": option "${field.value}" is not available. Options shown: ${texts.join(', ') || 'none'}.`);
    }
    clickLikeUser(matches[0]);
  }

  // Every editable control on the page, keyed by field label and whether it's inside the checklist.
  function snapshot(doc, cfg, section, targetLabels) {
    const S = cfg.selectors;
    const counts = {};
    const out = {};
    for (const el of all(doc, `${S.combobox}, ${S.native}`)) {
      if (closest(el, '#tca-root')) continue;
      let item = null;
      for (const sel of S.item) { item = closest(el, sel); if (item) break; }
      const labelEl = item && all(item, S.label)[0];
      const label = labelEl ? cleanText(labelEl, S.labelNoise) : '(unlabelled)';
      const inChecklist = within(section, el);
      if (inChecklist && targetLabels.has(norm(label))) continue;
      const where = inChecklist ? cfg.checklistTitle : 'elsewhere on the page';
      const key = `${where} › ${label}`;
      counts[key] = (counts[key] || 0) + 1;
      out[`${key}#${counts[key]}`] = readAny(el, cfg);
    }
    return out;
  }

  function firstDifference(before, after) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] !== after[key]) return key.replace(/#\d+$/, '');
    }
    return null;
  }

  function viewValue(item, cfg) {
    const el = all(item, cfg.selectors.viewValue).find(visible);
    return el ? cleanText(el, cfg.selectors.labelNoise) : null;
  }

  // A web address as typed in Salesforce ("shop.example.com", "https://…"), or null.
  function webAddress(text) {
    let t = String(text ?? '').trim().split(/\s+/)[0] || '';
    if (!t) return null;
    if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
    try {
      const url = new URL(t);
      return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? url.href : null;
    } catch { return null; }
  }

  // A record field read outside edit mode, from the active record only: one { text, href } per
  // matching field (href is a link's web address, if it has one). An empty list means no such field.
  function recordField(doc, cfg, label) {
    const S = cfg.selectors;
    const want = norm(label);
    const items = [];
    for (const labelEl of all(activeRoot(doc, cfg), S.label)) {
      if (norm(cleanText(labelEl, S.labelNoise)) !== want) continue;
      let item = null;
      for (const sel of S.item) { item = closest(labelEl, sel); if (item) break; }
      if (item && !items.includes(item)) items.push(item);
    }
    return items.map(item => ({
      text: viewValue(item, cfg) || '',
      href: all(item, 'a[href]').map(a => a.getAttribute('href')).find(h => /^https?:\/\//i.test(h)) || null
    }));
  }

  // The client's site from the record's Landing Page URL field: { url } or { reason }. A link's
  // address is preferred over its displayed text.
  function landingPageUrl(doc, cfg) {
    const found = recordField(doc, cfg, cfg.landingPageLabel);
    for (const f of found) {
      const url = webAddress(f.href || f.text);
      if (url) return { url };
    }
    return { reason: found.length ? `"${cfg.landingPageLabel}" is empty or isn't a web address` : `no "${cfg.landingPageLabel}" field found on this record` };
  }

  // The person in the record's Assigned TC field, or '' if it is empty or missing.
  const assignedTc = (doc, cfg) => (recordField(doc, cfg, cfg.assignedTcLabel).find(f => f.text) || {}).text || '';

  // ---------- Fill (and optionally save) ----------

  // opts.mode: 'save' (default) clicks Salesforce's Save; 'fill' stops before Save.
  async function run(doc, cfg, fields, opts = {}) {
    const S = cfg.selectors;
    const mode = opts.mode || 'save';
    let changed = 0;
    let inEditMode = false;
    const notes = [];
    const withNotes = message => [message, ...notes].join(' ');
    const fail = message => ({
      status: 'failed',
      message: changed ? `${message} ${changed} field(s) were changed but NOT saved — click Cancel to discard.`
        : inEditMode ? `${message} Nothing was changed or saved; click Cancel to leave edit mode.` : `${message} Nothing was changed or saved.`,
      changed
    });

    try {
      const targets = resolveTargets(doc, cfg, fields, notes);
      let section = await expandChecklist(doc, cfg);
      const current = () => (section.isConnected && visible(section) ? section : (section = findChecklist(doc, cfg).section));
      const control = field => { const item = rowFor(current(), cfg, field.label); return { item, ...controlFor(item, cfg, field.label) }; };

      // Clean baseline: Save commits the whole page, so unrelated unsaved edits would be saved with ours.
      if (isEditing(doc, cfg)) throw new StopError('The record is already in edit mode. Save or cancel your own edits first.');
      const items = targets.map(f => rowFor(section, cfg, f.label));

      // Enter edit mode through a pencil inside the Technical Checklist only.
      const pencil = items.map(i => all(i, S.editButton).filter(visible)).find(p => p.length === 1);
      if (!pencil) throw new StopError('No edit (pencil) button found on the checklist fields.');
      pencil[0].click();
      inEditMode = true;
      const ready = await waitFor(() => {
        if (!isEditing(doc, cfg)) return null;
        try { return all(rowFor(current(), cfg, targets[0].label), `${S.combobox}, ${S.native}`).some(visible); } catch { return null; }
      }, cfg.timeouts.editMode, cfg.pollMs);
      if (!ready) throw new StopError('Edit mode did not open.');
      await sleep(400);

      // Check every field before writing any (picklist options are only listed once opened, below).
      // Fields that should only be filled when empty and already have a value are left out here.
      const writes = [];
      for (const field of targets) {
        const c = control(field);
        if (c.kind === 'select' && ![...c.el.options].some(o => !o.disabled && picks(field, o.text, o.value))) {
          throw new StopError(`"${field.label}": option "${field.value}" is not available. Options shown: ${[...c.el.options].map(o => o.text).join(', ')}.`);
        }
        if (field.onlyIfEmpty && !isBlank(readAny(c.el, cfg))) { notes.push(`${field.label} already had a value, so it was kept.`); continue; }
        writes.push(field);
      }
      const targetLabels = new Set(writes.map(t => norm(t.label)));
      const before = snapshot(doc, cfg, current(), targetLabels);

      for (const field of writes) {
        const c = control(field);
        if (shows(field, readAny(c.el, cfg), cfg)) continue;
        if (c.kind === 'picklist') await choosePicklist(c, c.item, cfg, field);
        else if (c.kind === 'select') setNative(c.el, [...c.el.options].find(o => !o.disabled && picks(field, o.text, o.value)).value);
        else setNative(c.el, field.value);
        changed++;
        const kept = await waitFor(() => { try { return shows(field, readAny(control(field).el, cfg), cfg); } catch { return false; } }, cfg.timeouts.dropdown, cfg.pollMs);
        if (!kept) throw new StopError(`"${field.label}" did not keep its new value.`);
      }

      await sleep(300);
      const moved = firstDifference(before, snapshot(doc, cfg, current(), targetLabels));
      if (moved) throw new StopError(`"${moved}" changed unexpectedly, so nothing was saved.`);

      if (mode === 'fill') {
        return { status: 'filled', message: withNotes(`Filled ${writes.length} field(s) (${changed} changed). Not saved: check them, then click Salesforce's Save, or Cancel to discard.`), changed };
      }

      // Save exactly once, then wait for a definite outcome.
      const saves = saveButtons(doc, cfg);
      if (saves.length !== 1) throw new StopError(`Expected one Save button, found ${saves.length}.`);
      saves[0].click();
      const outcome = await waitFor(() => {
        const error = all(doc, S.error).filter(visible).map(e => cleanText(e, S.labelNoise)).find(Boolean);
        if (error) return { error };
        return isEditing(doc, cfg) ? null : { ok: true };
      }, cfg.timeouts.save, cfg.pollMs);

      if (!outcome) return { status: 'unconfirmed', message: 'Save was clicked but the page is still in edit mode with no error shown. Check the record before trying again.', changed };
      if (outcome.error) return { status: 'failed', message: `Salesforce did not save: ${outcome.error} Your ${changed} change(s) are still unsaved on the page.`, changed };

      // Read the saved values back from the record.
      const wrongNow = () => { try { const s = findChecklist(doc, cfg).section; return writes.filter(f => !shows(f, viewValue(rowFor(s, cfg, f.label), cfg), cfg)); } catch { return writes; } };
      const settled = await waitFor(() => (wrongNow().length ? null : true), cfg.timeouts.readBack, cfg.pollMs);
      if (!settled) {
        const wrong = wrongNow();
        return { status: 'unconfirmed', message: withNotes(`Saved, but ${wrong.length} field(s) don't show the expected value: ${wrong.map(f => f.label).join(', ')}.`), changed };
      }
      return { status: 'saved', message: withNotes(`Saved. ${writes.length} field(s) checked, ${changed} updated.`), changed };
    } catch (error) {
      if (error instanceof StopError) return fail(error.message);
      return fail(`Unexpected error: ${error.message}.`);
    }
  }

  // ---------- Read-only page check ----------

  // A structural report to copy back to the developer. Contains field labels, element names and
  // counts only: never field values, record names, IDs or URLs.
  function checkPage(doc, cfg, fields, opts = {}) {
    const S = cfg.selectors;
    const lines = [];
    const yes = b => (b ? 'yes' : 'no');
    const editing = isEditing(doc, cfg);
    lines.push(`Technical Checklist Autofill v${cfg.version} — page check`);
    lines.push(`Page type: ${opts.pageType || 'unknown'} · edit mode (Save button visible): ${yes(editing)}`);
    lines.push(`Settings: ${opts.personal ? `${opts.personal} personal change(s) from the team defaults` : 'team defaults'} · date format ${cfg.dateFormat}`);

    const titles = checklistTitles(doc, cfg);
    const shown = titles.filter(visible);
    lines.push(`Elements titled "${cfg.checklistTitle}": ${titles.length} (${shown.length} visible)`);
    for (const t of shown.slice(0, 5)) {
      const s = closest(t, S.section);
      lines.push(`  ${describe(t)} → section ${s ? describe(s) : 'NONE'} with ${s ? fieldItems(s, cfg).length : 0} field(s)`);
    }

    let section;
    try {
      const found = findChecklist(doc, cfg);
      section = found.section;
      if (found.collapsed) {
        lines.push('Section is collapsed. Fill expands it automatically; expand it and run Check page again for the field list.');
        return lines.join('\n');
      }
    } catch (error) {
      lines.push(`Result: ${error.message}`);
      const others = [...new Set(all(activeRoot(doc, cfg), S.section).filter(visible).map(s => { const t = all(s, '.slds-section__title, h2, h3')[0]; return t ? cleanText(t, S.labelNoise) : ''; }).filter(Boolean))];
      lines.push(`Visible section titles: ${others.slice(0, 30).join(' | ') || 'none found'}`);
      return lines.join('\n');
    }

    const items = fieldItems(section, cfg);
    const onPage = items.map(i => i.label);
    const specLabels = fields.map(f => f.label);
    const missing = specLabels.filter(l => !onPage.some(p => norm(p) === norm(l)));
    const extra = onPage.filter(p => !specLabels.some(l => norm(l) === norm(p)));
    const dupes = onPage.filter((p, i) => onPage.findIndex(q => norm(q) === norm(p)) !== i);
    lines.push(`Section: ${describe(section)} · ${items.length} field(s) found`);
    lines.push(`Specification labels found: ${specLabels.length - missing.length} of ${specLabels.length}`);
    if (missing.length) lines.push(`  Not found on page: ${missing.join(' | ')}`);
    if (extra.length) lines.push(`  On page but not in specification: ${extra.join(' | ')}`);
    if (dupes.length) lines.push(`  Appear more than once: ${dupes.join(' | ')}`);

    const created = createdDate(doc, cfg);
    lines.push(`${cfg.history.title}: ${created.date ? 'creation date found' : `✗ ${created.reason}`}`);
    const site = landingPageUrl(doc, cfg);
    lines.push(`${cfg.landingPageLabel}: ${site.url ? 'found' : `✗ ${site.reason}`} · template: ${opts.template || 'auto-detect (runs on Fill)'}`);
    lines.push(`${cfg.assignedTcLabel}: ${assignedTc(doc, cfg) ? 'found' : recordField(doc, cfg, cfg.assignedTcLabel).length ? 'empty' : '✗ not found on this record'}`);

    const { targets } = planTargets(fields);
    lines.push(`Fields to fill (${targets.length}):`);
    for (const f of targets) {
      let row;
      try { row = rowFor(section, cfg, f.label); } catch (error) { lines.push(`  ✗ ${error.message}`); continue; }
      const pencil = all(row, S.editButton).filter(visible).length;
      let control = '';
      if (editing) {
        try { control = ` · control: ${controlFor(row, cfg, f.label).kind}`; } catch (error) { control = ` · control: ✗ ${error.message}`; }
      }
      lines.push(`  ✓ ${f.label} · pencil: ${pencil ? 'yes' : 'no'}${control} → will set ${describeRule(f)}`);
    }

    // Structure of the first field, to correct selectors if needed (element names only).
    const sample = items[0];
    if (sample) {
      const chain = [];
      for (let n = sample.item; n && n !== section && chain.length < 8; n = parentOf(n)) if (n.nodeType === 1) chain.unshift(describe(n));
      lines.push(`Field structure (first field, section → field): ${chain.join(' > ')}`);
      const outline = [];
      const walk = (node, depth) => {
        for (const c of (shadowOf(node) || node).children) {
          if (outline.length >= 40) return;
          outline.push(`${'  '.repeat(depth + 1)}${describe(c)}${shadowOf(c) ? ' (shadow)' : ''}${c.getAttribute('role') ? ` [role=${c.getAttribute('role')}]` : ''}${c.getAttribute('name') ? ` [name=${c.getAttribute('name')}]` : ''}`);
          walk(c, depth + 1);
        }
      };
      walk(sample.item, 0);
      lines.push(...outline);
    }
    if (!editing) lines.push('Tip: click a Technical Checklist pencil, run Check page again, then Cancel. That adds the edit-mode controls to this report.');
    return lines.join('\n');
  }

  root.TCAEngine = { planTargets, findChecklist, fieldItems, run, checkPage, isEditing, all, parseDate, formatDate, createdDate, todayIso, landingPageUrl, recordField, assignedTc };
})(globalThis);
