// Platform templates: per-platform values for a few checklist fields, chosen in the panel or detected
// from the client's site. Classic script: exposes globalThis.TCATemplates. Templates themselves are in
// fields.js (TCA_TEMPLATES, generated from dev/field-specification.json); signs are in config.js.
(function (root) {
  // Team defaults with a template's values on top. Template values only fill empty fields, so an
  // answer someone already gave is never replaced. Fields the template doesn't list are unchanged.
  function applyTemplate(fields, template) {
    if (!template) return fields;
    const values = template.values;
    return fields.map(f => (Object.prototype.hasOwnProperty.call(values, f.label)
      ? { label: f.label, excluded: false, value: values[f.label], onlyIfEmpty: true }
      : f));
  }

  // The platform whose signs best match a site's page text (HTML plus response headers).
  // Returns { name } or { name: null, reason }: a tie between platforms counts as not detected.
  function detect(text, cfg) {
    const scores = Object.entries(cfg.platformSigns)
      .map(([name, signs]) => ({ name, score: signs.filter(sign => sign.test(text)).length }))
      .filter(s => s.score)
      .sort((a, b) => b.score - a.score);
    if (!scores.length) return { name: null, reason: 'no platform signs found on the site' };
    if (scores[1] && scores[1].score === scores[0].score) {
      return { name: null, reason: `the site shows signs of both ${scores[0].name} and ${scores[1].name}` };
    }
    return { name: scores[0].name };
  }

  root.TCATemplates = { applyTemplate, detect };
})(globalThis);
