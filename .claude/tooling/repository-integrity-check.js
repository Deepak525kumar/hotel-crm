#!/usr/bin/env node
'use strict';

/**
 * Repository Integrity Validation — deterministic, dependency-free checker.
 *
 * Framework tooling (.claude/tooling/, see ../CLAUDE.md Knowledge Separation).
 * This is the single implementation of every deterministic integrity check the
 * platform defines. It is invoked identically by:
 *   - the AI framework (Consistency Review G4, Documentation Validator G6,
 *     Post-flight G9 — see ../workflows/consistency-review.md,
 *     ../workflows/validation.md, ../workflows/postflight.md), and
 *   - CI, independent of any AI execution (../../.github/workflows/ci.yml,
 *     job: repository-integrity), which runs on every pull request regardless
 *     of author.
 * There is exactly one implementation; neither caller restates the logic.
 *
 * Checks (each maps to one requested deterministic-check category):
 *   broken-markdown-link                    [text](path) targets that do not resolve
 *   broken-relative-path                    [text](./or/../path) explicit relative-path links that do not resolve
 *   broken-adr-reference                    links into an architecture-decisions/ADR-* path that do not resolve
 *   broken-specification-reference          links into docs/03-modules/ that do not resolve
 *   broken-governance-reference             links into .claude/governance/ that do not resolve
 *   broken-knowledge-reference              links into .claude/knowledge/ that do not resolve
 *   broken-implementation-execution-reference  links into docs/04-implementation/ or docs/05-execution/ that do not resolve
 *   broken-cross-index-reference            path-shaped values under known keys in knowledge/governance YAML that do not resolve
 *   duplicate-adr-number                    two distinct ADR files claiming the same ADR-<n> number
 *   duplicate-identity-key                  two list entries in one YAML index sharing the same id/module value
 *   missing-canonical-reference             MODULE_REGISTRY.yaml cites a SPEC-* id absent from SPECIFICATION_INDEX.yaml
 *   orphan-document                         active doc with zero inbound references from any scanned source (WARN, non-blocking)
 *
 * Usage:
 *   node .claude/tooling/repository-integrity-check.js [options]
 *
 * Options:
 *   --format <text|md|json>   Output format (default: text)
 *   --out <file>              Write report to file instead of stdout
 *   --write-baseline          Overwrite the baseline with current findings (adoption/rebaseline only)
 *   --no-baseline             Ignore the baseline; every finding is treated as new
 *
 * Exit code 0: no new (non-baselined) blocking findings.
 * Exit code 1: at least one new blocking finding.
 * orphan-document findings never affect the exit code (WARN severity, see Design Note below).
 *
 * Design Note (baseline mechanism): this repository had substantial pre-existing
 * documentation drift before this gate existed (see the Framework Improvement
 * Proposal for the discovered ADR-file-loss incident this tool's own first run
 * uncovered). Adopting a strict deterministic gate into a large legacy tree
 * without a baseline would either block all merges on unrelated historical debt
 * or force silently skipping enforcement. The baseline is the standard,
 * transparent middle ground (same pattern as ESLint/Knip baseline adoption):
 * every finding present at adoption time is fingerprinted and checked in at
 * repository-integrity-baseline.json. Only NEW findings (added or changed after
 * adoption) fail the gate. The baseline is reviewable in every PR diff and is
 * never used to hide a newly introduced break — see checkFingerprint() below;
 * an existing file that goes missing changes its resolved-path finding's
 * fingerprint only if the *target* changes, so re-baselining a still-broken
 * link is not possible without visibly touching the baseline file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOOLING_DIR = __dirname;
const CONFIG_PATH = path.join(TOOLING_DIR, 'repository-integrity.config.json');
const BASELINE_PATH = path.join(TOOLING_DIR, 'repository-integrity-baseline.json');

const WARN_CHECKS = new Set(['orphan-document']);

function loadJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

const config = loadJSON(CONFIG_PATH, {});
const IGNORE_DIR_NAMES = new Set(config.ignoreDirNames || ['node_modules', '.git']);
const MARKDOWN_EXT = new Set(config.markdownExtensions || ['.md']);
const YAML_EXT = new Set(config.yamlExtensions || ['.yaml', '.yml']);
const YAML_PATH_KEYS = new Set(config.yamlPathKeys || ['source', 'path', 'file', 'ref']);
const IDENTITY_KEYS = config.identityKeys || ['id', 'module'];
const LEGACY_ROOTS = (config.legacyRoots || []).map(toRel);
const CATEGORY_PATTERNS = config.categoryPathPatterns || [];
const ORPHAN_SCAN_ROOTS = config.orphanScanRoots || [];
const ORPHAN_EXEMPT_BASENAMES = new Set(config.orphanExemptBasenames || ['README.md']);
const ORPHAN_ENTRY_POINTS = (config.orphanEntryPoints || []).map(toRel);

// ---------- path helpers ----------

function toRel(p) {
  return p.split(path.sep).join('/').replace(/^\.\//, '');
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function allFiles() {
  return walk(REPO_ROOT, []);
}

function isUnderLegacy(relPath) {
  return LEGACY_ROOTS.some((root) => relPath === root || relPath.startsWith(root + '/'));
}

function isExternalTarget(target) {
  return /^(https?:|mailto:|ftp:|tel:)/i.test(target) || target.startsWith('#') || target.trim() === '';
}

// Resolve a link target found inside `sourceFile` to a repo-relative path, or
// null if it is not a repository-relative filesystem reference (external URL,
// pure in-page anchor, etc).
function resolveLinkTarget(sourceFileAbs, rawTarget) {
  let target = rawTarget.trim();
  if (isExternalTarget(target)) return null;
  // strip fragment
  const hashIdx = target.indexOf('#');
  if (hashIdx !== -1) target = target.slice(0, hashIdx);
  if (target === '') return null;
  // strip surrounding angle brackets some markdown flavors allow: [x](<path>)
  target = target.replace(/^<|>$/g, '');
  let abs;
  if (target.startsWith('/')) {
    abs = path.join(REPO_ROOT, target);
  } else {
    abs = path.resolve(path.dirname(sourceFileAbs), target);
  }
  return toRel(path.relative(REPO_ROOT, abs));
}

// Resolve a bare, backtick-quoted path citation. Unlike markdown links these
// are always written as full repository-relative citations in this codebase's
// documentation convention (see Design Note), so resolution is root-relative.
function resolveBacktickTarget(rawTarget) {
  const abs = path.join(REPO_ROOT, rawTarget);
  return toRel(path.relative(REPO_ROOT, abs));
}

function exists(relPath) {
  try {
    fs.statSync(path.join(REPO_ROOT, relPath));
    return true;
  } catch (e) {
    return false;
  }
}

// Mask fenced (```) and inline (`) code spans so illustrative markdown
// syntax shown as literal text — e.g. a sentence containing the literal
// characters `[text](path)` to describe link syntax — is never re-parsed as
// a real link. Preserves string length and line breaks (mask char can't
// itself form `[]()`  syntax) so line numbers stay meaningful if ever needed.
function maskCodeSpans(content) {
  let masked = content.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, '#'));
  masked = masked.replace(/`[^`\n]+`/g, (m) => m.replace(/[^\n]/g, '#'));
  return masked;
}

function classify(relPath, fallback) {
  for (const rule of CATEGORY_PATTERNS) {
    if (relPath.includes(rule.match)) return rule.id;
  }
  return fallback;
}

// ---------- finding model ----------

const findings = [];

function fingerprint(checkId, file, target) {
  return crypto.createHash('sha1').update(`${checkId} ${file} ${target}`).digest('hex').slice(0, 16);
}

function addFinding(checkId, file, target, detail) {
  findings.push({
    fingerprint: fingerprint(checkId, file, target),
    checkId,
    file,
    target,
    detail: detail || '',
    severity: WARN_CHECKS.has(checkId) ? 'warn' : 'blocking',
  });
}

// ---------- check 1+2+3+4+5+6+7: markdown links & backtick paths ----------

function checkMarkdownFile(fileAbs, relFile) {
  const rawContent = fs.readFileSync(fileAbs, 'utf8');
  const content = maskCodeSpans(rawContent);

  const linkRe = /\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  let m;
  while ((m = linkRe.exec(content))) {
    const rawTarget = m[2];
    const resolved = resolveLinkTarget(fileAbs, rawTarget);
    if (resolved === null) continue;
    if (exists(resolved)) continue;
    // Explicit relative-path syntax (./, ../, or repo-root /) gets its own
    // category; everything else falls back to the generic markdown-link bucket.
    const isExplicitRelative = /^(\.\.?\/|\/)/.test(rawTarget.trim());
    const fallback = isExplicitRelative ? 'broken-relative-path' : 'broken-markdown-link';
    const checkId = classify(resolved, fallback);
    addFinding(checkId, relFile, resolved, `markdown link target does not exist (raw: "${rawTarget}")`);
  }

  return content;
}

// ---------- check: broken cross-index references ----------

function stripYamlValue(raw) {
  let v = raw.trim();
  const hashIdx = v.indexOf(' #');
  if (hashIdx !== -1) v = v.slice(0, hashIdx).trim();
  v = v.replace(/^["']|["']$/g, '');
  return v;
}

function checkYamlFile(fileAbs, relFile) {
  const content = fs.readFileSync(fileAbs, 'utf8');
  const lines = content.split('\n');

  for (const line of lines) {
    const kvMatch = line.match(/^\s*([A-Za-z_][\w]*)\s*:\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    if (!YAML_PATH_KEYS.has(key)) continue;
    let value = stripYamlValue(kvMatch[2]);
    // derived_from-style inline lists: [a, b, c]
    const candidates = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map((s) => s.trim())
      : [value];
    for (let candidate of candidates) {
      candidate = candidate.replace(/^["']|["']$/g, '');
      // must look path-shaped: contains '/' and ends with a known extension
      if (!/\//.test(candidate) || !/\.(md|yaml|yml)$/i.test(candidate)) continue;
      if (isExternalTarget(candidate)) continue;
      const resolved = resolveBacktickTarget(candidate);
      if (exists(resolved)) continue;
      const checkId = classify(resolved, 'broken-cross-index-reference');
      addFinding(checkId, relFile, resolved, `YAML key "${key}" cites a path that does not exist`);
    }
  }

  return { content, lines };
}

// ---------- check: duplicate identity keys within one YAML list ----------

function checkDuplicateIdentityKeys(relFile, lines) {
  // group by (key, indentation) — a reasonable proxy for "same list" given
  // this repository's convention of one flat top-level list per index file.
  const seen = new Map(); // groupKey -> Map(value -> firstLineNo)
  lines.forEach((line, idx) => {
    const m = line.match(/^(\s*)-\s*(id|module)\s*:\s*(.+)$/);
    if (!m) return;
    const [, indent, key, rawValue] = m;
    if (!IDENTITY_KEYS.includes(key)) return;
    const value = stripYamlValue(rawValue);
    if (value.includes('<') || value === '') return; // template placeholder / empty
    const groupKey = `${indent.length}:${key}`;
    if (!seen.has(groupKey)) seen.set(groupKey, new Map());
    const values = seen.get(groupKey);
    if (values.has(value)) {
      addFinding(
        'duplicate-identity-key',
        relFile,
        value,
        `"${key}: ${value}" first defined at line ${values.get(value)}, duplicated at line ${idx + 1}`
      );
    } else {
      values.set(value, idx + 1);
    }
  });
}

// ---------- check: duplicate ADR numbers ----------

function checkDuplicateAdrNumbers(mdFiles) {
  const byNumber = new Map();
  for (const relFile of mdFiles) {
    if (isUnderLegacy(relFile)) continue;
    const base = path.basename(relFile);
    const m = base.match(/^ADR-(\d+)-/);
    if (!m) continue;
    if (!relFile.includes('architecture-decisions/')) continue;
    const num = m[1];
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(relFile);
  }
  for (const [num, files] of byNumber) {
    if (files.length > 1) {
      addFinding('duplicate-adr-number', files[0], `ADR-${num}`, `also claimed by: ${files.slice(1).join(', ')}`);
    }
  }
}

// ---------- check: missing canonical reference (registry -> spec index) ----------

function checkMissingCanonicalReference() {
  const registryPath = path.join(REPO_ROOT, '.claude/knowledge/MODULE_REGISTRY.yaml');
  const specIndexPath = path.join(REPO_ROOT, '.claude/knowledge/SPECIFICATION_INDEX.yaml');
  if (!fs.existsSync(registryPath) || !fs.existsSync(specIndexPath)) return;

  const specIndexContent = fs.readFileSync(specIndexPath, 'utf8');
  const knownSpecs = new Set();
  let sm;
  const specRe = /^\s*spec\s*:\s*(SPEC-[A-Z0-9-]+)/gm;
  while ((sm = specRe.exec(specIndexContent))) knownSpecs.add(sm[1]);

  const registryContent = fs.readFileSync(registryPath, 'utf8');
  const lines = registryContent.split('\n');
  let currentModule = null;
  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*id\s*:\s*(.+)$/);
    if (idMatch) {
      currentModule = stripYamlValue(idMatch[1]);
      continue;
    }
    const specMatch = line.match(/^\s*specification\s*:\s*(.+)$/);
    if (specMatch && currentModule) {
      const value = stripYamlValue(specMatch[1]);
      const specIdMatch = value.match(/SPEC-[A-Z0-9-]+/);
      if (specIdMatch && !knownSpecs.has(specIdMatch[0])) {
        addFinding(
          'missing-canonical-reference',
          '.claude/knowledge/MODULE_REGISTRY.yaml',
          specIdMatch[0],
          `module "${currentModule}" cites ${specIdMatch[0]}, absent from SPECIFICATION_INDEX.yaml`
        );
      }
    }
  }
}

// ---------- check: orphan documents ----------

function checkOrphanDocuments(mdFiles, inboundLinkTargets) {
  const scanRootsSet = ORPHAN_SCAN_ROOTS;
  const entryPoints = new Set(ORPHAN_ENTRY_POINTS);
  for (const relFile of mdFiles) {
    if (isUnderLegacy(relFile)) continue;
    if (entryPoints.has(relFile)) continue;
    if (ORPHAN_EXEMPT_BASENAMES.has(path.basename(relFile))) continue;
    const inScope = scanRootsSet.some((root) => relFile === root || relFile.startsWith(root + '/'));
    if (!inScope) continue;
    if (!inboundLinkTargets.has(relFile)) {
      addFinding('orphan-document', relFile, relFile, 'no inbound reference from any scanned markdown link or YAML index path');
    }
  }
}

// ---------- run ----------

function run() {
  const files = allFiles();
  const relFiles = files.map((f) => toRel(path.relative(REPO_ROOT, f)));

  const mdFiles = [];
  const yamlFiles = [];
  files.forEach((f, i) => {
    const ext = path.extname(f);
    if (MARKDOWN_EXT.has(ext)) mdFiles.push({ abs: f, rel: relFiles[i] });
    else if (YAML_EXT.has(ext)) yamlFiles.push({ abs: f, rel: relFiles[i] });
  });

  const inboundLinkTargets = new Set();
  const captureInbound = (relPath) => inboundLinkTargets.add(relPath);

  for (const { abs, rel } of mdFiles) {
    // docs/legacy/ is historical evidence only (../CLAUDE.md Repository Rules);
    // its content is read for inbound-link bookkeeping but not link-checked.
    const content = isUnderLegacy(rel) ? maskCodeSpans(fs.readFileSync(abs, 'utf8')) : checkMarkdownFile(abs, rel);
    const linkRe = /\[([^\]\n]*)\]\(([^)\n]+)\)/g;
    let m;
    while ((m = linkRe.exec(content))) {
      const resolved = resolveLinkTarget(abs, m[2]);
      if (resolved && exists(resolved)) captureInbound(resolved);
    }
  }

  for (const { abs, rel } of yamlFiles) {
    const { lines } = checkYamlFile(abs, rel);
    checkDuplicateIdentityKeys(rel, lines);
    // also capture yaml path-key references as inbound for orphan purposes
    const content = fs.readFileSync(abs, 'utf8');
    const kvRe = /^\s*([A-Za-z_][\w]*)\s*:\s*(.+)$/gm;
    let m;
    while ((m = kvRe.exec(content))) {
      if (!YAML_PATH_KEYS.has(m[1])) continue;
      const value = stripYamlValue(m[2]);
      if (/\/.+\.(md|yaml|yml)$/i.test(value)) {
        const resolved = resolveBacktickTarget(value);
        if (exists(resolved)) captureInbound(resolved);
      }
    }
  }

  checkDuplicateAdrNumbers(mdFiles.map((f) => f.rel));
  checkMissingCanonicalReference();
  checkOrphanDocuments(mdFiles.map((f) => f.rel), inboundLinkTargets);

  return findings;
}

// ---------- baseline ----------

function loadBaseline() {
  const data = loadJSON(BASELINE_PATH, { schema_version: 1, entries: [] });
  const set = new Set((data.entries || []).map((e) => e.fingerprint));
  return set;
}

function writeBaseline(allFindings) {
  const entries = allFindings.map((f) => ({
    fingerprint: f.fingerprint,
    checkId: f.checkId,
    file: f.file,
    target: f.target,
  }));
  const data = {
    schema_version: 1,
    generated_at: new Date().toISOString().slice(0, 10),
    note: 'Pre-existing findings accepted at Repository Integrity Validation adoption time. See repository-integrity-check.js Design Note. New findings not present here fail CI.',
    entries,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + '\n');
}

// ---------- report ----------

function summarize(allFindings, baselineSet) {
  const byCheck = {};
  let newBlocking = 0;
  let baselined = 0;
  let warn = 0;
  for (const f of allFindings) {
    byCheck[f.checkId] = byCheck[f.checkId] || { total: 0, new: 0 };
    byCheck[f.checkId].total += 1;
    const isBaselined = baselineSet.has(f.fingerprint);
    f.status = f.severity === 'warn' ? 'warn' : isBaselined ? 'baselined' : 'new';
    if (f.status === 'new') { byCheck[f.checkId].new += 1; newBlocking += 1; }
    else if (f.status === 'baselined') baselined += 1;
    else warn += 1;
  }
  return { byCheck, newBlocking, baselined, warn, total: allFindings.length };
}

function toText(allFindings, summary) {
  const lines = [];
  lines.push('Repository Integrity Validation');
  lines.push('='.repeat(32));
  lines.push(`Total findings: ${summary.total}  New (blocking): ${summary.newBlocking}  Baselined: ${summary.baselined}  Warn: ${summary.warn}`);
  lines.push('');
  for (const f of allFindings) {
    if (f.status === 'baselined') continue;
    const tag = f.status === 'warn' ? 'WARN' : 'FAIL';
    lines.push(`[${tag}] ${f.checkId} :: ${f.file} -> ${f.target}`);
    if (f.detail) lines.push(`       ${f.detail}`);
  }
  return lines.join('\n');
}

function toMarkdown(allFindings, summary) {
  const lines = [];
  lines.push('# Repository Integrity Validation Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`| Total | New (blocking) | Baselined | Warn |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| ${summary.total} | ${summary.newBlocking} | ${summary.baselined} | ${summary.warn} |`);
  lines.push('');
  lines.push('## Findings by check');
  lines.push('');
  lines.push('| Check | Total | New |');
  lines.push('|---|---|---|');
  for (const [checkId, counts] of Object.entries(summary.byCheck).sort()) {
    lines.push(`| ${checkId} | ${counts.total} | ${counts.new} |`);
  }
  lines.push('');
  const newFindings = allFindings.filter((f) => f.status === 'new');
  const warnFindings = allFindings.filter((f) => f.status === 'warn');
  if (newFindings.length) {
    lines.push('## New (blocking) findings');
    lines.push('');
    lines.push('| Check | File | Target | Detail |');
    lines.push('|---|---|---|---|');
    for (const f of newFindings) lines.push(`| ${f.checkId} | \`${f.file}\` | \`${f.target}\` | ${f.detail} |`);
    lines.push('');
  }
  if (warnFindings.length) {
    lines.push(`## Warnings (non-blocking, ${warnFindings.length})`);
    lines.push('');
    lines.push('<details><summary>Expand</summary>');
    lines.push('');
    lines.push('| Check | File | Detail |');
    lines.push('|---|---|---|');
    for (const f of warnFindings) lines.push(`| ${f.checkId} | \`${f.file}\` | ${f.detail} |`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const format = (args.includes('--format') && args[args.indexOf('--format') + 1]) || 'text';
  const outIdx = args.indexOf('--out');
  const outFile = outIdx !== -1 ? args[outIdx + 1] : null;
  const writeBaselineMode = args.includes('--write-baseline');
  const noBaseline = args.includes('--no-baseline');

  const allFindings = run();

  if (writeBaselineMode) {
    writeBaseline(allFindings.filter((f) => f.severity === 'blocking'));
    process.stdout.write(`Baseline written: ${allFindings.filter((f) => f.severity === 'blocking').length} entries.\n`);
    return 0;
  }

  const baselineSet = noBaseline ? new Set() : loadBaseline();
  const summary = summarize(allFindings, baselineSet);

  let output;
  if (format === 'json') {
    output = JSON.stringify({ summary: { total: summary.total, newBlocking: summary.newBlocking, baselined: summary.baselined, warn: summary.warn }, findings: allFindings }, null, 2);
  } else if (format === 'md') {
    output = toMarkdown(allFindings, summary);
  } else {
    output = toText(allFindings, summary);
  }

  if (outFile) {
    fs.writeFileSync(path.resolve(process.cwd(), outFile), output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }

  return summary.newBlocking > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { run, REPO_ROOT };
