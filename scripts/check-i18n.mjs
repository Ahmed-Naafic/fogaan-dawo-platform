// Translation audit: en/so must have identical keys, and every static t('key') used in the web app must exist.
// CLI: `npm run check:i18n`. Also imported by tests/unit/i18n.test.js.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

export function auditTranslations() {
  const en = new Set(flatten(readJson(join(WEB_SRC, 'locales', 'en.json'))));
  const so = new Set(flatten(readJson(join(WEB_SRC, 'locales', 'so.json'))));
  const used = new Set();
  for (const file of sourceFiles(WEB_SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/label: '([a-z]+\.[a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/(?:title|body): '(landing\.[a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  }
  return {
    enCount: en.size,
    soCount: so.size,
    usedCount: used.size,
    missingInSo: [...en].filter((k) => !so.has(k)),
    extraInSo: [...so].filter((k) => !en.has(k)),
    undefinedKeys: [...used].filter((k) => !en.has(k)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = auditTranslations();
  console.log(`en keys: ${r.enCount}, so keys: ${r.soCount}, static keys used: ${r.usedCount}`);
  if (r.missingInSo.length) console.log('Missing in so:', r.missingInSo);
  if (r.extraInSo.length) console.log('Extra in so:', r.extraInSo);
  if (r.undefinedKeys.length) console.log('Used but undefined:', r.undefinedKeys);
  process.exit(r.missingInSo.length || r.extraInSo.length || r.undefinedKeys.length ? 1 : 0);
}
