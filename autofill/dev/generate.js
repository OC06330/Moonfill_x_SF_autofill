// Regenerates ../fields.js from field-specification.json. Run with: npm run generate
import {readFileSync, writeFileSync} from 'node:fs';
const spec = JSON.parse(readFileSync(new URL('field-specification.json', import.meta.url), 'utf8'));
const out = `// Generated from dev/field-specification.json (updated ${spec.updated}). Do not edit by hand: run \`npm run generate\`; tests check they match.
globalThis.TCA_FIELDS = ${JSON.stringify(spec.fields, null, 2)};
globalThis.TCA_TEMPLATES = ${JSON.stringify(spec.templates, null, 2)};
`;
writeFileSync(new URL('../fields.js', import.meta.url), out);
