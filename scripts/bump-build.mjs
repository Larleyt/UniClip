#!/usr/bin/env node
/**
 * bump-build — bump ONLY the build counter, keep the marketing version frozen.
 *
 * This is the everyday, high-frequency release path. It increments the single
 * monotonic build counter (`expo.android.versionCode`, mirrored into
 * `expo.ios.buildNumber`) and leaves `expo.version` untouched, so:
 *
 *   - iOS `CFBundleShortVersionString` (= expo.version) stays frozen → Apple
 *     does NOT re-trigger App Store / TestFlight review; only `CFBundleVersion`
 *     changes.
 *   - Android `versionName` becomes `${version}.${versionCode}` at prebuild
 *     (see plugins/withAndroidBuildVersionName.ts), so the in-app self-updater
 *     compares correctly against the release tag.
 *
 * The release MUST be tagged `v${version}.${versionCode}` (4 segments) — that
 * is the exact string the Android self-updater parses; `-b5` / `+5` style tags
 * do NOT parse and silently disable update detection.
 *
 * The counter is shared by every published artifact, whichever platforms it
 * ships (see scripts/build-counter.mjs), so the next value also skips past
 * every release tag on origin. Pass `--after N` when a number was consumed
 * outside the tag ledger, e.g. a TestFlight dev upload reported by
 * `npm run release:check-build`.
 *
 * Usage:
 *   node scripts/bump-build.mjs [--alpha] [--after N] [--dry-run]
 *   npm run release:build
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { highestBuildInTags, listReleaseTags } from './build-counter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = join(root, 'app.json');
const dryRun = process.argv.includes('--dry-run');
const alpha = process.argv.includes('--alpha');
const afterIndex = process.argv.indexOf('--after');
const after = afterIndex === -1 ? 0 : Number(process.argv[afterIndex + 1]);
if (!Number.isSafeInteger(after) || after < 0) {
  console.error('✗ --after requires a non-negative integer build number');
  process.exit(1);
}

let app;
try {
  app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`✗ could not read app.json: ${detail}`);
  process.exit(1);
}
const expo = app.expo;
if (!expo) {
  console.error('✗ app.json must contain an expo object');
  process.exit(1);
}
const version = String(expo.version); // 3-segment marketing version, stays frozen

const prevCode = Number(expo.android?.versionCode ?? 0);
const prevIosBuild = Number(expo.ios?.buildNumber ?? 0);
if (!Number.isFinite(prevCode) || !Number.isFinite(prevIosBuild)) {
  console.error('✗ could not read numeric versionCode / buildNumber from app.json');
  process.exit(1);
}

// One monotonic counter for both platforms; max() protects against any drift
// and against numbers that a single-platform release already consumed.
const { tags, source: tagSource } = listReleaseTags(root);
const highestTag = highestBuildInTags(tags);
const next = Math.max(prevCode, prevIosBuild, highestTag, after) + 1;
const previousAlphaNumber =
  expo.extra?.releaseChannel?.name === 'alpha' &&
  Number.isSafeInteger(expo.extra.releaseChannel.number)
    ? expo.extra.releaseChannel.number
    : 0;
const alphaNumber = alpha ? previousAlphaNumber + 1 : 0;
const tag = `v${version}.${next}${alpha ? `-alpha.${alphaNumber}` : ''}`;

expo.android = expo.android ?? {};
expo.ios = expo.ios ?? {};
expo.extra = expo.extra ?? {};
expo.android.versionCode = next;
expo.ios.buildNumber = String(next);
if (alpha) {
  expo.extra.releaseChannel = { name: 'alpha', number: alphaNumber };
} else {
  delete expo.extra.releaseChannel;
}

if (dryRun) {
  console.log(`[dry-run] marketing version (frozen): ${version}`);
  console.log(`[dry-run] build counter: ${prevCode}/${prevIosBuild} -> ${next}`);
  console.log(`[dry-run] highest release tag build (${tagSource}): ${highestTag}`);
  console.log(`[dry-run] android.versionCode -> ${next}, ios.buildNumber -> "${next}"`);
  if (alpha) console.log(`[dry-run] release channel -> alpha.${alphaNumber}`);
  console.log(`[dry-run] tag -> ${tag}`);
  process.exit(0);
}

writeFileSync(appJsonPath, `${JSON.stringify(app, null, 2)}\n`);

console.log(
  `✓ ${alpha ? `Alpha ${alphaNumber} ` : ''}build ${next}  (marketing version ${version} frozen)`
);
console.log(`  android.versionCode = ${next}, ios.buildNumber = "${next}"`);
console.log('');
console.log('Next steps:');
console.log(`  1. Add matching "${tag}" sections to CHANGES.md and CHANGES.en.md.`);
console.log('     Group notes under Common / iOS / Android sub-headings;');
console.log('     preview both languages with: node scripts/release-notes.mjs --print');
console.log('     generate client files with: npm run changelog:generate');
console.log('  2. Commit and push the release metadata:');
console.log(`       git add app.json CHANGES.md CHANGES.en.md changelogs`);
console.log(`       git commit -m "chore(release): ${tag.slice(1)}"`);
console.log(`       git push origin main`);
console.log('  3. In GitHub Actions, run "release" on main with');
console.log('     platforms set to both, android, or ios.');
console.log(`     CI will create ${tag} only after release preparation and the selected builds pass.`);
