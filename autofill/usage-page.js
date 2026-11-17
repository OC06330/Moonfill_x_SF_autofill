// Usage dashboard: reads the usage records through the background script (SharePoint, or this
// browser's waiting records if SharePoint isn't set up yet) and draws totals, bars and a table.
(function () {
  const U = globalThis.TCAUsage;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = n => n.toLocaleString('en-GB');
  let all = [];
  let sort = { key: 'total', dir: -1 };

  for (const tool of U.TOOLS) $('tool').append(new Option(tool, tool));

  // ---------- tooltip (enhances; every value is also in the table) ----------
  const tip = $('tip');
  function showTip(event, title, rows) {
    tip.replaceChildren(el('strong', null, title));
    for (const [cls, label, value] of rows) {
      const line = el('div');
      const key = el('span', 'line');
      key.style.background = cls ? `var(--${cls})` : 'var(--series)';
      line.append(key, el('strong', null, fmt(value)), document.createTextNode(` ${label}`));
      tip.append(line);
    }
    tip.hidden = false;
    const x = Math.min(event.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = Math.min(event.clientY + 14, innerHeight - tip.offsetHeight - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  function hover(target, title, rows) {
    target.tabIndex = 0;
    target.addEventListener('pointermove', e => showTip(e, title, rows));
    target.addEventListener('pointerleave', hideTip);
    target.addEventListener('focus', () => { const r = target.getBoundingClientRect(); showTip({ clientX: r.left, clientY: r.bottom }, title, rows); });
    target.addEventListener('blur', hideTip);
  }

  // ---------- filters ----------
  function inPeriod(iso, period) {
    if (period === 'all') return true;
    const now = new Date();
    const from = period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(now.getFullYear(), now.getMonth() - (period === '3m' ? 3 : 12), now.getDate());
    return new Date(iso) >= from;
  }
  const filtered = () => all.filter(r => inPeriod(r.When, $('period').value) && (!$('tool').value || r.Tool === $('tool').value));

  // ---------- drawing ----------
  function bars(container, items) {
    container.replaceChildren();
    if (!items.length) { container.append(el('div', 'empty', 'No uses in this period.')); container.style.display = 'block'; return; }
    container.style.display = '';
    const max = Math.max(...items.map(i => i.total));
    for (const item of items) {
      const track = el('div', 'track');
      const bar = el('div', 'bar');
      bar.style.width = `calc((100% - 48px) * ${item.total / max})`;
      for (const kind of ['success', 'failed']) {
        if (!item[kind]) continue;
        const seg = el('span', `seg ${kind}`);
        seg.style.flex = `${item[kind]} 0 0`;
        bar.append(seg);
      }
      hover(bar, item.key, [['good', 'succeeded', item.success], ['critical', 'failed', item.failed]]);
      track.append(bar, el('span', 'total', fmt(item.total)));
      const name = el('span', 'name', item.key);
      name.title = item.key;
      container.append(name, track);
    }
  }

  // Every week from the first to the last record, so quiet weeks show as gaps, not missing.
  function weeks(container, items) {
    container.replaceChildren();
    if (!items.length) { container.append(el('div', 'empty', 'No uses in this period.')); return; }
    const byWeek = new Map(items.map(w => [w.key, w]));
    const list = [];
    for (let d = new Date(items[0].key + 'T00:00:00Z'), end = new Date(items[items.length - 1].key + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const key = d.toISOString().slice(0, 10);
      list.push(byWeek.get(key) || { key, total: 0, success: 0, failed: 0 });
    }
    const top = Math.max(1, ...list.map(w => w.total));
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(s => top / s <= 5) || Math.ceil(top / 5);
    const ceiling = Math.ceil(top / step) * step;
    const cols = el('div', 'cols');
    for (let v = 0; v <= ceiling; v += step) {
      const pos = `${100 - (v / ceiling) * 100}%`;
      if (v) { const g = el('div', 'gridline'); g.style.top = pos; cols.append(g); }
      const t = el('span', 'tick', fmt(v)); t.style.top = pos; cols.append(t);
    }
    const labels = el('div', 'weeks');
    const every = Math.ceil(list.length / 8);
    list.forEach((w, i) => {
      const col = el('div', 'col');
      const fill = el('span');
      fill.style.height = `${(w.total / ceiling) * 100}%`;
      col.append(fill);
      const day = new Date(w.key + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      hover(col, `Week of ${day}`, [[null, 'uses', w.total], ['critical', 'failed', w.failed]]);
      cols.append(col);
      labels.append(el('span', null, i % every === 0 ? day : ''));
    });
    container.append(cols, labels);
  }

  function reasons(items) {
    const body = $('reasons');
    body.replaceChildren();
    if (!items.length) { const tr = el('tr'); const td = el('td', 'empty', 'No failed attempts in this period.'); td.colSpan = 2; tr.append(td); body.append(tr); return; }
    for (const r of items) {
      const tr = el('tr');
      tr.append(el('td', null, U.REASON_LABELS[r.key] || r.key), el('td', 'num', fmt(r.failed)));
      body.append(tr);
    }
  }

  function table(rows) {
    const body = $('table');
    body.replaceChildren();
    const { key, dir } = sort;
    rows.sort((a, b) => (typeof a[key] === 'number' ? (a[key] - b[key]) * dir : String(a[key]).localeCompare(String(b[key])) * dir) || b.total - a.total);
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'empty', 'No uses in this period.'); td.colSpan = 5; tr.append(td); body.append(tr); return; }
    for (const r of rows) {
      const tr = el('tr');
      tr.append(el('td', null, r.person), el('td', null, r.tool), el('td', 'num', fmt(r.success)), el('td', 'num', fmt(r.failed)), el('td', 'num', fmt(r.total)));
      body.append(tr);
    }
  }

  function draw() {
    const s = U.summarise(filtered());
    $('k-total').textContent = fmt(s.total);
    $('k-rate').textContent = s.total ? `${Math.round((s.success / s.total) * 100)}%` : '–';
    $('k-failed').textContent = fmt(s.failed);
    $('k-people').textContent = fmt(s.people.length);
    bars($('people'), s.people);
    bars($('tools'), s.tools);
    weeks($('weeks'), s.weeks);
    reasons(s.reasons);
    table(s.table);
  }

  async function load() {
    $('error').textContent = '';
    $('source').textContent = 'Loading…';
    let answer;
    try { answer = await chrome.runtime.sendMessage({ action: 'tcaUsageRows' }); } catch (error) { answer = { error: error.message, rows: [] }; }
    answer = answer || { error: 'no answer from the extension', rows: [] };
    all = (answer.rows || []).filter(r => r && r.When);
    const local = answer.source !== 'sharepoint';
    $('source').textContent = local ? 'This browser only' : 'SharePoint';
    if (local) $('source').dataset.local = ''; else delete $('source').dataset.local;
    $('error').textContent = answer.error ? `Couldn't read SharePoint: ${answer.error}. Showing this browser's waiting records.` : '';
    $('footer').textContent = local
      ? 'Usage reporting isn\'t connected to SharePoint yet, so this shows only the uses recorded in this browser. They are sent once the SharePoint list is set up.'
      : `${fmt(all.length)} records. Updated ${new Date().toLocaleString('en-GB')}.`;
    draw();
  }

  $('period').addEventListener('change', draw);
  $('tool').addEventListener('change', draw);
  $('refresh').addEventListener('click', load);
  for (const b of document.querySelectorAll('th button')) {
    b.addEventListener('click', () => {
      const key = b.dataset.sort;
      sort = { key, dir: sort.key === key ? -sort.dir : (key === 'person' || key === 'tool' ? 1 : -1) };
      draw();
    });
  }
  load();
})();
