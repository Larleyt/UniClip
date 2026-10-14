#!/usr/bin/env node
/**
 * bump-version — bump the marketing version. RARE, and the one thing that
 * re-triggers iOS App Store / TestFlight review, so do it deliberately.
 *
 * Sets `expo.version` to a new 3-segment marketing version (iOS
 * `CFBundleShortVersionString` must be exactly MAJOR.MINOR.PATCH — Apple
 * rejects 4-segment marketing versions) AND still bumps the build counter
 * (never reset), so the release stays tagged `v${newVersion}.${versionCode}`
 * and the Android self-updater's comparison remains monotonic across the
 * version change. Like bump-build, the next counter skips past every release
 * tag on origin and past `--after N` (see scripts/build-counter.mjs).
 *
 * Usage:
 *   node scripts/bump-version.mjs <major.minor.patch> [--after N] [--dry-run]
 *   npm run release:version -- 1.4.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { highestBuildInTags, listReleaseTags } from './build-counter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = join(root, 'app.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const afterIndex = args.indexOf('--after');
const after = afterIndex === -1 ? 0 : Number(args[afterIndex + 1]);
const newVersion = args.find(
  (a, index) => !a.startsWith('--') && (afterIndex === -1 || index !== afterIndex + 1)
);

if (!newVersion) {
  console.error('Usage: node scripts/bump-version.mjs <major.minor.patch> [--after N] [--dry-run]');
  process.exit(1);
}
if (!Number.isSafeInteger(after) || after < 0) {
  console.error('✗ --after requires a non-negative integer build number');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(
    `✗ "${newVersion}" is not a 3-segment version. iOS CFBundleShortVersionString must be MAJOR.MINOR.PATCH (the build counter lives in the tag/versionName, not here).`
  );
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
const prevVersion = String(expo.version);

const prevCode = Number(expo.android?.versionCode ?? 0);
const prevIosBuild = Number(expo.ios?.buildNumber ?? 0);
if (!Number.isFinite(prevCode) || !Number.isFinite(prevIosBuild)) {
  console.error('✗ could not read numeric versionCode / buildNumber from app.json');
  process.exit(1);
}

// Build counter keeps climbing across the marketing-version change (never reset),
// and past numbers that single-platform releases already consumed.
const highestTag = highestBuildInTags(listReleaseTags(root).tags);
const next = Math.max(prevCode, prevIosBuild, highestTag, after) + 1;
const tag = `v${newVersion}.${next}`;

expo.version = newVersion;
expo.android = expo.android ?? {};
expo.ios = expo.ios ?? {};
expo.extra = expo.extra ?? {};
expo.android.versionCode = next;
expo.ios.buildNumber = String(next);
delete expo.extra.releaseChannel;

if (dryRun) {
  console.log(
    `[dry-run] marketing version: ${prevVersion} -> ${newVersion} (⚠ re-triggers iOS review)`
  );
  console.log(`[dry-run] build counter: ${prevCode}/${prevIosBuild} -> ${next}`);
  console.log(`[dry-run] android.versionCode -> ${next}, ios.buildNumber -> "${next}"`);
  console.log(`[dry-run] tag -> ${tag}`);
  process.exit(0);
}

writeFileSync(appJsonPath, `${JSON.stringify(app, null, 2)}\n`);

console.log(`✓ marketing version ${prevVersion} -> ${newVersion}  (build ${next})`);
console.log('  ⚠ This is a NEW iOS marketing version — expect one App Store / TestFlight review.');
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
