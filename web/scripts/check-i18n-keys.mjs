#!/usr/bin/env node

/**
 * Discovers locale bundles, verifies that frontend/backend expose the same
 * locale set, and checks that every frontend bundle has the same keys as en.
 *
 * Usage: node scripts/check-i18n-keys.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, '..', 'src', 'locales');
const serverLocalesDir = join(__dirname, '..', '..', 'server', 'internal', 'i18n');

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function localeCodes(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
}

const locales = localeCodes(localesDir);
const serverLocales = localeCodes(serverLocalesDir);
if (JSON.stringify(locales) !== JSON.stringify(serverLocales)) {
  console.error(`❌ Frontend locales (${locales.join(', ')}) do not match backend locales (${serverLocales.join(', ')})`);
  process.exit(1);
}

const flatByLocale = {};
for (const locale of locales) {
  const obj = JSON.parse(readFileSync(join(localesDir, `${locale}.json`), 'utf-8'));
  flatByLocale[locale] = new Set(flattenKeys(obj));
}

const en = flatByLocale.en;
let failed = false;

for (const locale of locales) {
  if (locale === 'en') continue;
  const target = flatByLocale[locale];
  const missing = [...en].filter((k) => !target.has(k)).sort();
  const extra = [...target].filter((k) => !en.has(k)).sort();
  if (missing.length > 0) {
    console.error(`❌ ${missing.length} key(s) in en.json but missing in ${locale}.json:`);
    missing.forEach((k) => console.error(`  - ${k}`));
    failed = true;
  }
  if (extra.length > 0) {
    console.error(`❌ ${extra.length} key(s) in ${locale}.json but missing in en.json:`);
    extra.forEach((k) => console.error(`  - ${k}`));
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log(
    `✅ i18n keys consistent across ${locales.join(', ')}: ${en.size} keys each`,
  );
}
