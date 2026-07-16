#!/usr/bin/env node
'use strict';

/**
 * Context Loader — deterministic, dependency-free Context Management Layer engine.
 *
 * Framework tooling (.claude/tooling/, see ../CLAUDE.md Knowledge Separation).
 * This is the single implementation of the loading behaviour the platform's
 * Context Management Layer defines. Canonical *policy* lives in
 * ../constitution/CONTEXT_ARTIFACTS.md (§8); this script only *operationalises*
 * that policy against the authored manifests in ../context/. It restates no
 * gate, finding schema, confidence rule, or loop bound.
 *
 * It is invoked identically by:
 *   - the AI framework (Pre-flight boot/reuse, Repository-Synchronization
 *     rebuild, Post-flight prune — see ../workflows/preflight.md,
 *     ../workflows/repository-synchronization.md, ../workflows/postflight.md), and
 *   - CI, independent of any AI execution (../../.github/workflows/ci.yml,
 *     job: context-manifest), via `--validate`, on every pull request.
 *
 * Capabilities (each maps to one requested Context-Management behaviour):
 *   resolve       deterministic minimum load set for a workflow (deterministic loading,
 *                 artifact-level dependency loading, lazy loading, reuse of warm context,
 *                 revision-aware loading, delta loading vs. the prior checkpoint)
 *   --emit        write SESSION_CONTEXT.yaml + CACHE_STATE.yaml checkpoints (session
 *                 checkpointing, cache state, execution manifest instance)
 *   --prune       report/remove checkpoint artifacts no longer required (automatic pruning)
 *   --measure     measurable reduction of the resolved set vs. a naive full load
 *   --validate    structural integrity of the manifests (validation gate; CI + G4 sub-check)
 *
 * Usage:
 *   node .claude/tooling/context-loader.js resolve --workflow <id> [--format text|md|json] [--emit] [--prune]
 *   node .claude/tooling/context-loader.js --measure [--workflow <id>] [--format text|md|json]
 *   node .claude/tooling/context-loader.js --validate [--format text|md|json]
 *
 * Options:
 *   --workflow <id>   Workflow whose minimum load set to resolve (e.g. preflight, documentation).
 *   --head <rev>      Treat <rev> as current HEAD for revision-aware cache checks (default: recorded stamp).
 *   --format <fmt>    text (default) | md | json.
 *   --emit            Persist SESSION_CONTEXT.yaml + CACHE_STATE.yaml (generated, git-ignored).
 *   --prune           Drop artifacts absent from the resolved set from the checkpoint.
 *
 * Exit code 0: success / no validation error.
 * Exit code 1: a --validate error, or a usage error.
 *
 * Fail-safe (CONTEXT_ARTIFACTS.md §1.5): every cache/checkpoint this script
 * produces is advisory and reconstructable. On any doubt the caller re-derives
 * by re-running the producing workflow; a missing manifest degrades to pre-1.5.0
 * behaviour (read every authoritative document), never to a governance gap.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOOLING_DIR = __dirname;
const CONFIG_PATH = path.join(TOOLING_DIR, 'context-loader.config.json');

// ---------- tiny helpers ----------

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function readText(relOrAbs) {
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(REPO_ROOT, relOrAbs);
  return fs.readFileSync(abs, 'utf8');
}
function exists(rel) {
  try { fs.statSync(path.join(REPO_ROOT, rel)); return true; } catch (e) { return false; }
}
function bytesOf(rel) {
  try { return fs.statSync(path.join(REPO_ROOT, rel)).size; } catch (e) { return 0; }
}

const config = readJSON(CONFIG_PATH, {});
const P = config.paths || {};
const BYTES_PER_TOKEN = (config.tokenModel && config.tokenModel.bytesPerToken) || 4;
const KNOWN_PREFIXES = config.knownArtifactPrefixes || [];

// ---------- minimal YAML-subset parser ----------
// Supports exactly the shapes used by the manifests: block mappings, block
// sequences whose items are scalars / inline flow lists / mappings, inline flow
// lists [a, b], and quoted or bare scalars. No anchors, multiline scalars, or
// nested flow maps. Deliberately small and total (never throws on our inputs).

function stripComment(line) {
  // remove a trailing " # ..." comment when not inside quotes (our files never
  // quote a '#'); also a full-line comment.
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i);
    }
  }
  return line;
}
function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
function parseScalar(v) {
  v = v.trim();
  if (v === '') return null;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => unquote(s.trim()));
  }
  return unquote(v);
}
function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

// Parse into JS structures. `lines` is a list of {indent, text}. Returns [value, nextIndex].
function parseBlock(lines, start, minIndent) {
  // Decide: sequence (first non-empty line at >= minIndent starts with '- ') or mapping.
  let i = start;
  while (i < lines.length && lines[i].text.trim() === '') i++;
  if (i >= lines.length) return [null, i];
  const baseIndent = lines[i].indent;
  if (baseIndent < minIndent) return [null, start];

  const isSeq = /^-(\s|$)/.test(lines[i].text.trim());
  if (isSeq) {
    const arr = [];
    while (i < lines.length) {
      if (lines[i].text.trim() === '') { i++; continue; }
      if (lines[i].indent < baseIndent) break;
      if (lines[i].indent > baseIndent) break; // handled by recursion below
      const t = lines[i].text.trim();
      if (!/^-(\s|$)/.test(t)) break;
      const rest = t.replace(/^-\s*/, '');
      if (rest === '') {
        // nested block belongs to this item
        const [val, ni] = parseBlock(lines, i + 1, baseIndent + 1);
        arr.push(val);
        i = ni;
      } else if (/^[^:\s][^:]*:(\s|$)/.test(rest) || /^"[^"]*":/.test(rest)) {
        // item is a mapping starting on the dash line: "- key: value"
        // Reconstruct a virtual line set for this mapping at a deeper indent.
        const virt = [{ indent: baseIndent + 2, text: rest }];
        // gather subsequent deeper lines
        let j = i + 1;
        while (j < lines.length && (lines[j].text.trim() === '' || lines[j].indent > baseIndent)) {
          if (lines[j].text.trim() !== '') virt.push({ indent: lines[j].indent, text: lines[j].text.trim() ? lines[j].text.replace(/^\s*/, '') : '' });
          j++;
        }
        // Build proper virtual lines preserving relative indentation
        const virtLines = [{ indent: 0, text: rest }];
        for (let k = i + 1; k < j; k++) {
          if (lines[k].text.trim() === '') continue;
          virtLines.push({ indent: lines[k].indent - (baseIndent + 2), text: lines[k].text.trim() });
        }
        const [val] = parseBlock(virtLines, 0, 0);
        arr.push(val);
        i = j;
      } else {
        arr.push(parseScalar(rest));
        i++;
      }
    }
    return [arr, i];
  }

  // mapping
  const obj = {};
  while (i < lines.length) {
    if (lines[i].text.trim() === '') { i++; continue; }
    if (lines[i].indent < baseIndent) break;
    if (lines[i].indent > baseIndent) break;
    const t = lines[i].text.trim();
    const m = t.match(/^("[^"]*"|[^:]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = unquote(m[1]);
    const valPart = m[2];
    if (/^[|>]/.test(valPart.trim())) {
      // block scalar (| or >, with optional chomping indicator): consume all
      // subsequent more-indented lines as opaque text (content is never needed
      // by the loader — only structural keys are).
      const buf = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].text.trim() === '' || lines[j].indent > baseIndent)) {
        buf.push(lines[j].text.trim());
        j++;
      }
      obj[key] = buf.join(' ').trim();
      i = j;
    } else if (valPart.trim() === '') {
      const [val, ni] = parseBlock(lines, i + 1, baseIndent + 1);
      obj[key] = val;
      i = ni;
    } else {
      obj[key] = parseScalar(valPart);
      i++;
    }
  }
  return [obj, i];
}

function parseYaml(text) {
  const rawLines = text.split('\n').map(stripComment);
  const lines = rawLines
    .map((l) => ({ indent: indentOf(l), text: l }))
    .filter((l) => l.text.trim() !== '' && l.text.trim() !== '---');
  const [val] = parseBlock(lines, 0, 0);
  return val || {};
}

function loadManifest(relPath) {
  if (!relPath || !exists(relPath)) return null;
  try { return parseYaml(readText(relPath)); } catch (e) { return null; }
}

// ---------- source-state readers (authoritative upstreams) ----------

function currentFrameworkVersion() {
  try {
    const m = readText(P.version).match(/current_version:\s*([0-9]+\.[0-9]+\.[0-9]+)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
function recordedBaselineRevision() {
  // The actively-maintained per-revision stamp lives in SYNC_STATE.yaml cache_state.
  try {
    const txt = readText(P.syncState);
    const idx = txt.indexOf('cache_state:');
    const scope = idx >= 0 ? txt.slice(idx) : txt;
    const m = scope.match(/baseline_revision:\s*([0-9a-f]{7,40})/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
function contextInvalidators() {
  try {
    const txt = readText(P.syncState);
    const m = txt.match(/context_invalidators:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (!m) return [];
    return m[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  } catch (e) { return []; }
}
function sessionState() {
  const s = loadManifest(P.sessionState) || {};
  return s.session || {};
}

// ---------- resolution ----------

function artifactPrefix(ref) {
  const m = String(ref).match(/^(ART-[A-Z-]+?)(?:-[0-9<].*)?$/);
  if (m) return m[1];
  // fall back: strip trailing -NNN or -<...>
  return String(ref).replace(/-[0-9].*$/, '').replace(/-<.*$/, '');
}

function collectDocs(entryList) {
  // entryList: array of {path, load} → normalised doc descriptors
  const docs = [];
  for (const e of entryList || []) {
    if (!e || !e.path) continue;
    docs.push({ path: e.path, load: e.load || 'eager', exists: exists(e.path), bytes: bytesOf(e.path) });
  }
  return docs;
}

function resolve(workflowId, opts) {
  const boot = loadManifest(P.bootManifest) || {};
  const exec = loadManifest(P.executionManifest) || {};
  const deps = loadManifest(P.artifactDependencies) || {};
  const fwVersion = currentFrameworkVersion();
  const baseRev = recordedBaselineRevision();
  const headRev = opts.head || baseRev;
  const session = sessionState();

  const wfList = (exec.workflows || []);
  const wf = wfList.find((w) => w && w.id === workflowId);
  if (!wf) {
    return { error: `unknown workflow "${workflowId}"; known: ${wfList.map((w) => w && w.id).filter(Boolean).join(', ')}` };
  }

  // 1. deterministic base: boot documents + workflow documents
  const bootDocs = collectDocs(boot.documents);
  const wfDocs = collectDocs(wf.documents);

  // 2. artifact-level dependency expansion
  const requestedArtifacts = new Set((wf.artifacts || []).map((a) => (a && a.ref) || a).filter(Boolean));
  const depEdges = (deps.artifacts || []);
  const expanded = new Set(requestedArtifacts);
  let changed = true;
  while (changed) {
    changed = false;
    for (const ref of Array.from(expanded)) {
      const node = depEdges.find((n) => n && (n.id === ref || artifactPrefix(n.id) === artifactPrefix(ref)));
      for (const dep of (node && node.depends_on) || []) {
        if (!expanded.has(dep)) { expanded.add(dep); changed = true; }
      }
    }
  }

  // 3. revision-aware validity + warm-context reuse
  const revValid = baseRev && headRev && baseRev === headRev;
  const bootValid = (boot.framework_version === fwVersion);
  const warm = [];
  const cold = [];
  for (const ref of expanded) {
    const node = depEdges.find((n) => n && n.id === ref);
    const scope = (node && node.cache_scope) || 'revision';
    let isWarm;
    if (scope === 'framework-version') isWarm = bootValid;
    else if (scope === 'revision' || scope === 'revision+capability') isWarm = revValid;
    else isWarm = false;
    (isWarm ? warm : cold).push({ ref, cache_scope: scope, lazy: !!(node && node.lazy) });
  }

  // 4. delta vs prior checkpoint
  const prior = loadManifest(config.emit && config.emit.sessionContext) || null;
  const priorRefs = new Set((prior && prior.loaded_artifacts || []).map((x) => x.ref || x));
  const priorRev = prior && prior.baseline_revision;
  const revisionChanged = prior && priorRev && baseRev && priorRev !== baseRev;
  const deltaArtifacts = revisionChanged
    ? Array.from(expanded) // stale checkpoint ⇒ everything reloads
    : Array.from(expanded).filter((r) => !priorRefs.has(r));

  // 5. lazy split: eager docs load now, lazy on demand
  const eagerDocs = [...bootDocs, ...wfDocs].filter((d) => d.load !== 'lazy');
  const lazyDocs = [...bootDocs, ...wfDocs].filter((d) => d.load === 'lazy');

  return {
    workflow: workflowId,
    framework_version: fwVersion,
    baseline_revision: baseRev,
    head_revision: headRev,
    revision_valid: revValid,
    boot_context_valid: bootValid,
    gates: wf.gates || [],
    boot_documents: bootDocs,
    workflow_documents: wfDocs,
    eager_documents: eagerDocs,
    lazy_documents: lazyDocs,
    requested_artifacts: Array.from(requestedArtifacts),
    resolved_artifacts: Array.from(expanded),
    warm_artifacts: warm,
    cold_artifacts: cold,
    delta_artifacts: deltaArtifacts,
    revision_changed_since_checkpoint: !!revisionChanged,
  };
}

// ---------- measure ----------

function walkUniverse() {
  const roots = (config.universe && config.universe.roots) || [];
  const exts = new Set((config.universe && config.universe.includeExtensions) || ['.md', '.yaml', '.yml']);
  const exclude = new Set((config.universe && config.universe.excludeBasenames) || []);
  const out = [];
  const walk = (relDir) => {
    let entries;
    try { entries = fs.readdirSync(path.join(REPO_ROOT, relDir), { withFileTypes: true }); } catch (e) { return; }
    for (const en of entries) {
      const rel = relDir + '/' + en.name;
      if (en.isDirectory()) walk(rel);
      else if (en.isFile() && exts.has(path.extname(en.name)) && !exclude.has(en.name)) out.push(rel);
    }
  };
  roots.forEach(walk);
  return out;
}
function tokensForBytes(b) { return Math.ceil(b / BYTES_PER_TOKEN); }
function docTokens(docs) { return docs.reduce((s, d) => s + tokensForBytes(d.bytes), 0); }

function measure(opts) {
  const universe = walkUniverse();
  const fullBytes = universe.reduce((s, r) => s + bytesOf(r), 0);
  const fullTokens = tokensForBytes(fullBytes);

  const exec = loadManifest(P.executionManifest) || {};
  const rows = [];
  const targets = opts.workflow
    ? (exec.workflows || []).filter((w) => w && w.id === opts.workflow)
    : (exec.workflows || []);
  for (const wf of targets) {
    const r = resolve(wf.id, opts);
    if (r.error) continue;
    const minTokens = docTokens(r.eager_documents);
    // delta load = only cold (not warm) eager documents' worth, approximated by
    // eager docs whose backing artifact is cold; boot docs count only when boot invalid.
    const warmRev = r.revision_valid;
    const deltaTokens = warmRev ? docTokens(r.workflow_documents.filter((d) => d.load !== 'lazy')) : minTokens;
    rows.push({
      workflow: wf.id,
      min_tokens: minTokens,
      delta_tokens: deltaTokens,
      reduction_pct: fullTokens ? Math.round((1 - minTokens / fullTokens) * 100) : 0,
      delta_reduction_pct: fullTokens ? Math.round((1 - deltaTokens / fullTokens) * 100) : 0,
    });
  }
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.reduction_pct, 0) / rows.length) : 0;
  const avgDelta = rows.length ? Math.round(rows.reduce((s, r) => s + r.delta_reduction_pct, 0) / rows.length) : 0;
  return { full_documents: universe.length, full_tokens: fullTokens, rows, avg_reduction_pct: avg, avg_delta_reduction_pct: avgDelta };
}

// ---------- validate ----------

function validate() {
  const errors = [];
  const warnings = [];
  const boot = loadManifest(P.bootManifest);
  const exec = loadManifest(P.executionManifest);
  const deps = loadManifest(P.artifactDependencies);
  const fwVersion = currentFrameworkVersion();

  if (!boot) errors.push(`BOOT_MANIFEST missing/unparseable at ${P.bootManifest}`);
  if (!exec) errors.push(`EXECUTION_MANIFEST missing/unparseable at ${P.executionManifest}`);
  if (!deps) errors.push(`ARTIFACT_DEPENDENCIES missing/unparseable at ${P.artifactDependencies}`);
  if (errors.length) return { errors, warnings };

  // 1. framework_version alignment
  if (boot.framework_version !== fwVersion) {
    errors.push(`BOOT_MANIFEST.framework_version (${boot.framework_version}) != VERSION.yaml current_version (${fwVersion})`);
  }
  if (exec.framework_version !== fwVersion) {
    errors.push(`EXECUTION_MANIFEST.framework_version (${exec.framework_version}) != VERSION.yaml current_version (${fwVersion})`);
  }

  // 2. every referenced document path resolves
  const checkDocs = (docs, where) => {
    for (const d of docs || []) {
      if (d && d.path && !exists(d.path)) errors.push(`${where}: document path does not exist: ${d.path}`);
      if (d && d.load && !['eager', 'lazy'].includes(d.load)) errors.push(`${where}: invalid load mode "${d.load}" for ${d.path}`);
    }
  };
  checkDocs(boot.documents, 'BOOT_MANIFEST');

  // 3. every workflow file has an entry, and vice-versa
  const declared = new Set((exec.workflows || []).map((w) => w && w.id).filter(Boolean));
  const ignore = new Set(config.workflowIgnore || []);
  let onDisk = [];
  try {
    onDisk = fs.readdirSync(path.join(REPO_ROOT, P.workflowsDir))
      .filter((f) => f.endsWith('.md') && !ignore.has(f))
      .map((f) => f.replace(/\.md$/, ''));
  } catch (e) { errors.push(`cannot read workflows dir ${P.workflowsDir}`); }
  for (const wfId of onDisk) {
    if (!declared.has(wfId)) errors.push(`workflow "${wfId}" has no EXECUTION_MANIFEST entry (.claude/workflows/${wfId}.md)`);
  }
  const seen = new Set();
  for (const wf of exec.workflows || []) {
    if (!wf || !wf.id) { errors.push('EXECUTION_MANIFEST has a workflow entry without an id'); continue; }
    if (seen.has(wf.id)) errors.push(`duplicate workflow id "${wf.id}" in EXECUTION_MANIFEST`);
    seen.add(wf.id);
    if (wf.file && !exists(wf.file)) errors.push(`workflow "${wf.id}" file does not exist: ${wf.file}`);
    checkDocs(wf.documents, `workflow ${wf.id}`);
    for (const a of wf.artifacts || []) {
      const ref = (a && a.ref) || a;
      const pref = artifactPrefix(ref);
      if (!KNOWN_PREFIXES.includes(pref)) errors.push(`workflow "${wf.id}" references unknown artifact prefix "${pref}" (ref ${ref})`);
    }
  }

  // 4. dependency edges reference declared artifacts; invalidation triggers ⊆ canonical
  const declaredArtifactIds = new Set((deps.artifacts || []).map((n) => n && n.id).filter(Boolean));
  const canonicalInvalidators = contextInvalidators();
  for (const node of deps.artifacts || []) {
    if (!node || !node.id) { errors.push('ARTIFACT_DEPENDENCIES has a node without an id'); continue; }
    for (const dep of node.depends_on || []) {
      if (!declaredArtifactIds.has(dep)) warnings.push(`artifact "${node.id}" depends_on undeclared node "${dep}"`);
    }
    for (const inv of node.invalidated_by || []) {
      if (canonicalInvalidators.length && !canonicalInvalidators.some((c) => c === inv || c.includes(inv) || inv.includes(c))) {
        warnings.push(`artifact "${node.id}" invalidated_by "${inv}" not found among SYNC_STATE.context_invalidators`);
      }
    }
  }

  return { errors, warnings };
}

// ---------- emit / prune ----------

function emitCheckpoints(res, opts) {
  const emit = config.emit || {};
  const fwVersion = res.framework_version;
  const baseRev = res.baseline_revision;
  const loaded = res.resolved_artifacts.map((ref) => {
    const w = res.warm_artifacts.find((x) => x.ref === ref);
    return { ref, state: w ? 'warm' : 'cold' };
  });

  let checkpointArtifacts = loaded;
  if (opts.prune) {
    // automatic pruning: keep only what the current workflow resolved
    const keep = new Set(res.resolved_artifacts);
    checkpointArtifacts = loaded.filter((x) => keep.has(x.ref));
  }

  const sessionContext = [
    '# GENERATED by .claude/tooling/context-loader.js — do NOT edit by hand.',
    '# Authoritative session record: .claude/knowledge/SESSION_STATE.yaml (CONTEXT_ARTIFACTS.md §6).',
    '# This is a revision-bound checkpoint of the loaded working set for one workflow run;',
    '# it is advisory and reconstructable (CONTEXT_ARTIFACTS.md §1.5) and git-ignored.',
    'schema_version: 1',
    'generated: true',
    `generated_at: ${new Date().toISOString().slice(0, 10)}`,
    `generator: .claude/tooling/context-loader.js`,
    `authoritative_source: .claude/knowledge/SESSION_STATE.yaml`,
    `framework_version: ${fwVersion}`,
    `baseline_revision: ${baseRev}`,
    `workflow: ${res.workflow}`,
    `revision_valid: ${res.revision_valid}`,
    'loaded_artifacts:',
    ...checkpointArtifacts.map((x) => `  - ref: ${x.ref}\n    state: ${x.state}`),
    'eager_documents:',
    ...res.eager_documents.map((d) => `  - ${d.path}`),
    'lazy_documents:',
    ...res.lazy_documents.map((d) => `  - ${d.path}`),
    '',
  ].join('\n');

  const cacheState = [
    '# GENERATED by .claude/tooling/context-loader.js — do NOT edit by hand.',
    '# Authoritative cache record: .claude/knowledge/SYNC_STATE.yaml `cache_state` (CONTEXT_ARTIFACTS.md §3).',
    '# Regenerated on boot, after repository synchronization, and at post-flight prune.',
    'schema_version: 1',
    'generated: true',
    `generated_at: ${new Date().toISOString().slice(0, 10)}`,
    `generator: .claude/tooling/context-loader.js`,
    `authoritative_source: .claude/knowledge/SYNC_STATE.yaml`,
    `framework_version: ${fwVersion}`,
    `baseline_revision: ${baseRev}`,
    `boot_context_valid: ${res.boot_context_valid}`,
    `revision_valid: ${res.revision_valid}`,
    'artifacts:',
    ...res.resolved_artifacts.map((ref) => {
      const w = res.warm_artifacts.find((x) => x.ref === ref);
      return `  - ref: ${ref}\n    valid: ${w ? true : false}\n    cache_scope: ${(w || (res.cold_artifacts.find((c) => c.ref === ref)) || {}).cache_scope || 'revision'}`;
    }),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(REPO_ROOT, emit.sessionContext), sessionContext);
  fs.writeFileSync(path.join(REPO_ROOT, emit.cacheState), cacheState);
  return { sessionContext: emit.sessionContext, cacheState: emit.cacheState, pruned: opts.prune ? (res.resolved_artifacts.length) : null };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--emit') opts.emit = true;
    else if (a === '--prune') opts.prune = true;
    else if (a === '--validate') opts.validate = true;
    else if (a === '--measure') opts.measure = true;
    else if (a === '--workflow') opts.workflow = argv[++i];
    else if (a === '--head') opts.head = argv[++i];
    else if (a === '--format') opts.format = argv[++i];
    else opts._.push(a);
  }
  if (!opts.format) opts.format = 'text';
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];

  if (opts.validate) {
    const { errors, warnings } = validate();
    if (opts.format === 'json') {
      process.stdout.write(JSON.stringify({ errors, warnings }, null, 2) + '\n');
    } else {
      const L = [];
      L.push('Context Manifest Validation');
      L.push('='.repeat(27));
      L.push(`Errors: ${errors.length}  Warnings: ${warnings.length}`);
      errors.forEach((e) => L.push(`[FAIL] ${e}`));
      warnings.forEach((w) => L.push(`[WARN] ${w}`));
      if (!errors.length && !warnings.length) L.push('OK — all manifests structurally valid.');
      process.stdout.write(L.join('\n') + '\n');
    }
    process.exit(errors.length ? 1 : 0);
  }

  if (opts.measure) {
    const m = measure(opts);
    if (opts.format === 'json') { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); return; }
    const L = [];
    L.push('Context Loading — Measurable Reduction');
    L.push('='.repeat(38));
    L.push(`Full load (naive boot): ${m.full_documents} documents, ~${m.full_tokens} tokens`);
    L.push('');
    L.push('Workflow                         min tokens   reduction   warm-delta reduction');
    for (const r of m.rows) {
      L.push(`${r.workflow.padEnd(32)} ${String(r.min_tokens).padStart(10)}   ${String(r.reduction_pct + '%').padStart(8)}   ${String(r.delta_reduction_pct + '%').padStart(19)}`);
    }
    L.push('');
    L.push(`Average minimum-load reduction:  ${m.avg_reduction_pct}%`);
    L.push(`Average warm-delta reduction:    ${m.avg_delta_reduction_pct}%`);
    process.stdout.write(L.join('\n') + '\n');
    return;
  }

  if (cmd === 'resolve') {
    if (!opts.workflow) { process.stderr.write('resolve requires --workflow <id>\n'); process.exit(1); }
    const res = resolve(opts.workflow, opts);
    if (res.error) { process.stderr.write(res.error + '\n'); process.exit(1); }
    let emitted = null;
    if (opts.emit) emitted = emitCheckpoints(res, opts);
    if (opts.format === 'json') { process.stdout.write(JSON.stringify({ ...res, emitted }, null, 2) + '\n'); return; }
    const L = [];
    L.push(`Context Resolution — workflow: ${res.workflow}`);
    L.push('='.repeat(40));
    L.push(`framework_version: ${res.framework_version}   baseline_revision: ${res.baseline_revision}`);
    L.push(`boot_context_valid: ${res.boot_context_valid}   revision_valid: ${res.revision_valid}`);
    L.push(`gates: ${res.gates.join(', ') || '(none)'}`);
    L.push('');
    L.push(`Eager documents (${res.eager_documents.length}):`);
    res.eager_documents.forEach((d) => L.push(`  + ${d.path}${d.exists ? '' : '  [MISSING]'}`));
    if (res.lazy_documents.length) {
      L.push(`Lazy documents (load on demand) (${res.lazy_documents.length}):`);
      res.lazy_documents.forEach((d) => L.push(`  ~ ${d.path}`));
    }
    L.push('');
    L.push(`Resolved artifacts (${res.resolved_artifacts.length}): ${res.resolved_artifacts.join(', ')}`);
    L.push(`Warm (reused, not reloaded) (${res.warm_artifacts.length}): ${res.warm_artifacts.map((w) => w.ref).join(', ') || '(none)'}`);
    L.push(`Cold (must load) (${res.cold_artifacts.length}): ${res.cold_artifacts.map((c) => c.ref).join(', ') || '(none)'}`);
    L.push(`Delta since checkpoint (${res.delta_artifacts.length}): ${res.delta_artifacts.join(', ') || '(none — checkpoint current)'}`);
    if (emitted) L.push(`\nEmitted: ${emitted.sessionContext}, ${emitted.cacheState}${opts.prune ? ' (pruned)' : ''}`);
    process.stdout.write(L.join('\n') + '\n');
    return;
  }

  process.stderr.write('usage: context-loader.js resolve --workflow <id> | --measure | --validate  [--format text|md|json] [--emit] [--prune]\n');
  process.exit(1);
}

main();
