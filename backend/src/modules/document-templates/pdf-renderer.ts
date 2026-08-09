// Document Templates module (2026-08-09): HTML-to-PDF rendering via
// Playwright/headless Chromium. Chosen over pdf-lib (built for filling
// fixed AcroForm fields on a PRE-EXISTING PDF -- there is none here) and
// pdfkit (programmatic drawing API, wrong tool for long-form legal prose
// with dynamic values interpolated mid-paragraph). CSS gives correct
// pagination/text-layout for free; this module's whole job is building the
// HTML string and letting the browser lay it out.

import { chromium } from 'playwright';
import {
  DocumentInstance,
  DocumentInstanceFieldValue,
  DocumentTemplateField,
  DocumentTemplateSection,
  DocumentTemplateSignatureBlock,
} from '@prisma/client';
import { getStorageClient } from '../documents/storage.js';

type SectionWithChildren = DocumentTemplateSection & {
  fields: DocumentTemplateField[];
  signature_blocks: DocumentTemplateSignatureBlock[];
};

type TemplateWithSections = {
  name: string;
  sections: SectionWithChildren[];
};

type InstanceWithChildren = DocumentInstance & {
  field_values: DocumentInstanceFieldValue[];
  signatures: { signature_block_id: string; signature_image_key: string }[];
};

// HTML-escapes an interpolated field value -- body_template's static prose
// is admin-authored (trusted), but field VALUES are user input and must
// never be interpreted as markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function interpolateBody(section: SectionWithChildren, instance: InstanceWithChildren): string {
  const valueByFieldId = new Map(instance.field_values.map((v) => [v.field_id, v.value]));
  let html = section.body_template;
  for (const field of section.fields) {
    const raw = valueByFieldId.get(field.id);
    const display = raw != null && raw !== '' ? escapeHtml(raw) : `<span class="unfilled">[${escapeHtml(field.label)}]</span>`;
    // Simple, non-recursive {{field_key}} substitution -- body_template is
    // admin-authored, not user-supplied, so a naive split/join is
    // sufficient (no need to guard against template-injection from field
    // VALUES, which are HTML-escaped above before substitution).
    html = html.split(`{{${field.field_key}}}`).join(display);
  }
  return html;
}

async function signatureImgTag(key: string): Promise<string> {
  const storage = await getStorageClient();
  const url = await storage.getPresignedUrl(key).catch(() => null);
  if (!url) return '<div class="signature-missing">[signature image unavailable]</div>';
  // A presigned S3 URL is fetched server-side (Playwright's own page
  // navigation can reach it directly since it's a real HTTPS URL) --
  // simpler than round-tripping bytes through this process to build a
  // data-URI, and avoids holding a second full copy of the image in memory.
  return `<img class="signature-image" src="${url}" alt="Signature" />`;
}

async function renderSignatureBlockHtml(
  block: DocumentTemplateSignatureBlock,
  instance: InstanceWithChildren
): Promise<string> {
  const signature = instance.signatures.find((s) => s.signature_block_id === block.id);
  const imgHtml = signature
    ? await signatureImgTag(signature.signature_image_key)
    : '<div class="signature-line">&nbsp;</div>';
  return `
    <div class="signature-block">
      <div class="signature-label">${escapeHtml(block.label)}</div>
      ${imgHtml}
    </div>
  `;
}

/**
 * Renders ONE section's interpolated body + its signature blocks to a
 * standalone HTML string -- used both as a fragment of the full-document
 * render below, and independently as the exact input hashed into
 * DocumentInstanceSignature.content_hash_at_signing (so "what did they see
 * when they signed" is answerable per-section, per-signing-moment, not
 * just for the whole final document).
 */
export async function renderSectionHtml(
  section: SectionWithChildren,
  instance: InstanceWithChildren
): Promise<string> {
  const body = interpolateBody(section, instance);
  const blocksHtml = await Promise.all(
    section.signature_blocks
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((b) => renderSignatureBlockHtml(b, instance))
  );
  return `
    <section class="doc-section">
      <h2>${escapeHtml(section.title)}</h2>
      <div class="doc-body">${body}</div>
      ${blocksHtml.join('')}
    </section>
  `;
}

const PAGE_STYLE = `
  <style>
    @page { size: A4; margin: 20mm 18mm; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111; }
    .doc-section { break-before: page; }
    .doc-section:first-child { break-before: auto; }
    h2 { font-size: 13pt; margin-bottom: 12pt; }
    .doc-body { white-space: pre-wrap; }
    .unfilled { color: #b91c1c; font-style: italic; }
    .signature-block { margin-top: 24pt; page-break-inside: avoid; }
    .signature-label { font-size: 9pt; color: #555; margin-bottom: 4pt; }
    .signature-image { max-height: 60pt; max-width: 200pt; display: block; }
    .signature-line { border-bottom: 1px solid #999; width: 200pt; height: 40pt; }
    .signature-missing { font-size: 9pt; color: #b91c1c; }
    .draft-banner { position: fixed; top: 8mm; right: 8mm; color: #b91c1c; font-size: 9pt; font-weight: bold; }
  </style>
`;

/**
 * Renders a full DocumentInstance (all sections, in order) to a PDF Buffer.
 * `draft: true` allows rendering before every signature block is signed
 * (unsigned blocks render as an empty line, per the explicit draft-preview
 * decision) -- `finalize()` always calls with `draft: false` and only after
 * confirming every required block IS signed.
 */
export async function renderInstanceToPdf(
  template: TemplateWithSections,
  instance: InstanceWithChildren,
  opts: { draft: boolean }
): Promise<Buffer> {
  const sections = template.sections.slice().sort((a, b) => a.order_index - b.order_index);
  const sectionsHtml = await Promise.all(sections.map((s) => renderSectionHtml(s, instance)));
  const html = `
    <!doctype html>
    <html>
      <head><meta charset="utf-8" />${PAGE_STYLE}</head>
      <body>
        ${opts.draft ? '<div class="draft-banner">DRAFT — NOT YET SIGNED</div>' : ''}
        <h1>${escapeHtml(template.name)}</h1>
        ${sectionsHtml.join('')}
      </body>
    </html>
  `;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return pdf;
  } finally {
    await browser.close();
  }
}
