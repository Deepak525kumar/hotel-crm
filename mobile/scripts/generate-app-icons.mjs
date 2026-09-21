#!/usr/bin/env node
/**
 * Regenerates both apps' icon sets from one source definition each.
 *
 * WHY THIS EXISTS AS A SCRIPT, not as six checked-in PNGs someone edited by
 * hand: until 2026-09-21 both apps shipped Expo's own template icon, byte for
 * byte identical (`shasum` matched across `worker-app` and `checker-app`), so
 * a phone with both installed showed two indistinguishable blue Expo marks and
 * the App Store would have received Expo's logo as the app's brand. Fixing
 * that means six raster sizes per app, per platform, that must stay in step;
 * regenerating them from one vector source is the only way that survives the
 * next change. Re-run after editing GLYPHS or BRANDS:
 *
 *     node mobile/scripts/generate-app-icons.mjs
 *
 * The two marks are deliberately one family: same weight, same geometry, same
 * white-on-gradient treatment. They differ in the thing the app is FOR -- a
 * bed for the people who make up the rooms, a check for the people who inspect
 * them -- rather than in decoration, so the pair is still legible at the ~60px
 * a home screen actually renders.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const MOBILE_DIR = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');

/** Marks are authored in a 1024x1024 box and scaled from there. */
const GLYPHS = {
  // Side-view bed: headboard, mattress, pillow, two feet.
  bed: (fill) => `
    <rect x="170" y="320" width="80" height="310" rx="40" fill="${fill}"/>
    <rect x="270" y="385" width="200" height="90" rx="45" fill="${fill}"/>
    <rect x="170" y="470" width="684" height="140" rx="60" fill="${fill}"/>
    <rect x="196" y="606" width="60" height="96" rx="30" fill="${fill}"/>
    <rect x="768" y="606" width="60" height="96" rx="30" fill="${fill}"/>`,
  // Check inside a rounded square: inspected and signed off.
  check: (fill) => `
    <rect x="200" y="200" width="624" height="624" rx="160"
          fill="none" stroke="${fill}" stroke-width="72"/>
    <path d="M 350 516 L 462 628 L 690 396" fill="none" stroke="${fill}"
          stroke-width="86" stroke-linecap="round" stroke-linejoin="round"/>`,
};

const BRANDS = {
  'worker-app': {
    glyph: 'bed',
    // The blue already used by this app's splash screen, so the icon and the
    // first screen a housekeeper sees are the same colour.
    from: '#2E96F5',
    to: '#0B63C5',
    adaptiveBackground: '#E6F4FE',
  },
  'checker-app': {
    glyph: 'check',
    // Deliberately far from the worker blue: the two apps sit side by side on
    // a checker's phone, and hue is what distinguishes them at a glance.
    from: '#14B58C',
    to: '#0A7A5E',
    adaptiveBackground: '#E3F7F1',
  },
};

/** Fits the 1024-space glyph into `size`, scaled by `scale` and centred. */
function glyphLayer(brand, fill, width, height, scale) {
  const side = Math.min(width, height) * scale;
  const factor = side / 1024;
  const dx = (width - side) / 2;
  const dy = (height - side) / 2;
  return `<g transform="translate(${dx} ${dy}) scale(${factor})">${GLYPHS[brand.glyph](fill)}</g>`;
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function gradientDef(brand) {
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${brand.from}"/><stop offset="1" stop-color="${brand.to}"/>
  </linearGradient></defs>`;
}

/** Full-bleed square: iOS and the web favicon apply their own mask. */
function filled(brand, size, scale) {
  return svg(size, size,
    `${gradientDef(brand)}<rect width="${size}" height="${size}" fill="url(#g)"/>` +
    glyphLayer(brand, '#FFFFFF', size, size, scale));
}

async function render(markup, outPath) {
  await sharp(Buffer.from(markup)).png().toFile(outPath);
  console.log(`  ${path.relative(MOBILE_DIR, outPath)}`);
}

for (const [app, brand] of Object.entries(BRANDS)) {
  const images = path.join(MOBILE_DIR, app, 'assets', 'images');
  await mkdir(images, { recursive: true });
  console.log(`${app}:`);

  // The master, kept in the repo so the raster set is reproducible.
  await writeFile(path.join(images, 'icon.svg'), `${filled(brand, 1024, 0.68)}\n`);
  console.log(`  ${path.relative(MOBILE_DIR, path.join(images, 'icon.svg'))}`);

  await render(filled(brand, 1024, 0.68), path.join(images, 'icon.png'));
  await render(filled(brand, 48, 0.72), path.join(images, 'favicon.png'));

  await render(
    svg(512, 512, `${gradientDef(brand)}<rect width="512" height="512" fill="url(#g)"/>`),
    path.join(images, 'android-icon-background.png'));

  // 0.45, not 0.68: Android masks an adaptive foreground down to roughly the
  // middle two-thirds, and a glyph sized for the full square loses its edges.
  await render(
    svg(512, 512, glyphLayer(brand, '#FFFFFF', 512, 512, 0.45)),
    path.join(images, 'android-icon-foreground.png'));

  // Themed icons are tinted by the launcher, so this ships as a silhouette.
  await render(
    svg(432, 432, glyphLayer(brand, '#000000', 432, 432, 0.45)),
    path.join(images, 'android-icon-monochrome.png'));

  // Non-square on purpose -- kept at the dimensions the splash config was
  // already laid out against.
  await render(
    svg(228, 213, glyphLayer(brand, '#FFFFFF', 228, 213, 0.9)),
    path.join(images, 'splash-icon.png'));
}
