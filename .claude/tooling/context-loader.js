#!/usr/bin/env node
'use strict';

/**
 * Context Loader — deterministic, dependency-free Context Management Layer engine.
 *
 * Framework tooling (.claude/tooling/, see ../CLAUDE.md Knowledge Separation).
 * Canonical *policy* lives in ../constitution/CONTEXT_ARTIFACTS.md (§8); this
 * script only *operationalises* it against the authored JSON manifests in
 * ../context/. It restates no gate, finding schema, confidence rule, or loop bound.
 *
 * Invoked identically by the AI framework (Pre-flight resolve) and by CI
 * (../../.github/workflows/ci.yml, job context-manifest, `--validate` only).
 *
 * Design constraints (framework 1.5.0 refinement):
 *   - No handwritten parser: authored manifests are JSON (JSON.parse). Only a
 *     few narrow regexes read the pre-existing framework YAML files this tool
 *     does not own (VERSION / SYNC_STATE / SESSION_STATE).
 *   - No persistent generated state: SESSION_CONTEXT / CACHE_STATE are gone.
 *     Warm/cold and the load delta are DERIVED at call time from the
 *     authoritative SESSION_STATE.yaml (§6) and SYNC_STATE.yaml cache_state (§3),
 *     so there is nothing to store, rebuild, or prune by hand.
 *   - Reduced invalidation scope: the framework-version-scoped Boot Context is
 *     keyed by a content DIGEST of its boot documents, not the version string —
 *     a version bump that changes no boot document does not invalidate it (§8).
 *
 * Capabilities:
 *   resolve --workflow <id>   minimum load set (deterministic + artifact-dependency
 *                             + lazy loading), warm-context reuse, and the load
 *                             delta (= the cold set) derived from session state.
 *   --measure [--workflow id] ESTIMATED reduction vs. a naive full load (byte proxy).
 *   --validate                correctness of the manifests (CI + G4 sub-check).
 *
 * Options: --workflow <id> | --head <rev> | --format text|json
 * Exit 0: success / no validation error.  Exit 1: --validate error or usage error.
 *
 * Fail-safe (CONTEXT_ARTIFACTS.md §1.5): a missing manifest degrades to pre-1.5.0
 * behaviour (read every authoritative document), never to a governance gap.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(__dirname, 'context-loader.config.json');

// ---------- io ----------

function readJSON(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')); }
  catch (e) { return fallback; }
}
function readText(rel) { return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); }
function exists(rel) { try { fs.statSync(path.join(REPO_ROOT, rel)); return true; } catch (e) { return false; } }
function bytesOf(rel) { try { return fs.statSync(path.join(REPO_ROOT, rel)).size; } catch (e) { return 0; } }
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const P = config.paths;
const BYTES_PER_TOKEN = config.tokenModel.bytesPerToken;
const KNOWN_PREFIXES = config.knownArtifactPrefixes;

// ---------- narrow readers for the pre-existing framework YAML we do not own ----------

function versionCurrent() {
  try { return (readText(P.version).match(/current_version:\s*([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] || null; }
  catch (e) { return null; }
}
// baseline_revision + boot_context key from the SYNC_STATE.yaml cache_state block only.
function syncCacheState() {
  try {
    const txt = readText(P.syncState);
    const scope = txt.slice(Math.max(0, txt.indexOf('cache_state:')));
    const baseline = (scope.match(/baseline_revision:\s*([0-9a-f]{7,40})/) || [])[1] || null;
    const bootKey = (scope.match(/boot_context:.*?key:\s*([^,}\n]+)/) || [])[1];
    return { baseline, bootKey: bootKey ? bootKey.trim() : null };
  } catch (e) { return { baseline: null, bootKey: null }; }
}
// active + baseline_revision from the SESSION_STATE.yaml session block only.
function sessionInfo() {
  try {
    const txt = readText(P.sessionState);
    const scope = txt.slice(Math.max(0, txt.indexOf('session:')));
    const active = /\bactive:\s*true\b/.test(scope);
    const baseline = (scope.match(/baseline_revision:\s*([0-9a-f]{7,40})/) || [])[1] || null;
    return { active, baseline };
  } catch (e) { return { active: false, baseline: null }; }
}

// ---------- manifests ----------

function manifests() {
  return {
    boot: readJSON(P.bootManifest, null),
    exec: readJSON(P.executionManifest, null),
    deps: readJSON(P.artifactDependencies, null),
  };
}
function artifactPrefix(ref) {
  const m = String(ref).match(/^(ART-[A-Z-]+?)(?:-[0-9<].*)?$/);
  return m ? m[1] : String(ref);
}
function workflowFile(id) { return `${P.workflowsDir}/${id}.md`; }

// Content digest of the boot document set — the Boot Context cache key (§8).
function bootDigest(boot) {
  const parts = (boot.documents || [])
    .map((d) => `${d.path}:${exists(d.path) ? sha1(readText(d.path)) : 'MISSING'}`)
    .sort();
  return sha1(parts.join('\n')).slice(0, 16);
}

// ---------- resolve ----------

function resolve(workflowId, opts) {
  const { boot, exec, deps } = manifests();
  if (!boot || !exec || !deps) return { error: 'manifests missing/unparseable (fail-safe: read every authoritative document)' };

  const wf = (exec.workflows || []).find((w) => w.id === workflowId);
  if (!wf) return { error: `unknown workflow "${workflowId}"; known: ${(exec.workflows || []).map((w) => w.id).join(', ')}` };

  // documents: boot set + workflow set
  const toDoc = (d) => ({ path: d.path, load: d.load || 'eager', exists: exists(d.path), bytes: bytesOf(d.path) });
  const bootDocs = (boot.documents || []).map(toDoc);
  const wfDocs = (wf.documents || []).map(toDoc);

  // artifact-level dependency expansion (transitive)
  const nodeOf = (ref) => (deps.artifacts || []).find((n) => n.id === ref || artifactPrefix(n.id) === artifactPrefix(ref));
  const requested = new Set(wf.artifacts || []);
  const resolved = new Set(requested);
  for (let changed = true; changed;) {
    changed = false;
    for (const ref of Array.from(resolved)) {
      for (const dep of (nodeOf(ref) || {}).depends_on || []) {
        if (!resolved.has(dep)) { resolved.add(dep); changed = true; }
      }
    }
  }

  // warm/cold derived from authoritative session + cache state (no stored file)
  const { baseline: syncBaseline, bootKey } = syncCacheState();
  const session = sessionInfo();
  const currentBaseline = opts.head || syncBaseline;
  const revisionMatch = !!(session.active && currentBaseline && session.baseline && currentBaseline === session.baseline);
  const bootWarm = !!(bootKey && bootKey === bootDigest(boot));

  const warm = [], cold = [];
  for (const ref of resolved) {
    const scope = (nodeOf(ref) || {}).cache_scope || 'revision';
    let isWarm;
    if (scope === 'framework-version') isWarm = bootWarm;
    else if (scope === 'candidate-version') isWarm = false;
    else isWarm = revisionMatch; // revision, revision+capability, module+freeze-revision
    (isWarm ? warm : cold).push({ ref, cache_scope: scope });
  }

  const allDocs = [...bootDocs, ...wfDocs];
  return {
    workflow: workflowId,
    framework_version: versionCurrent(),
    baseline_revision: currentBaseline,
    revision_valid: revisionMatch,
    boot_context_valid: bootWarm,
    boot_cache_key: bootDigest(boot),
    eager_documents: allDocs.filter((d) => d.load !== 'lazy'),
    lazy_documents: allDocs.filter((d) => d.load === 'lazy'),
    resolved_artifacts: Array.from(resolved),
    warm_artifacts: warm,      // reused by reference, not reloaded
    cold_artifacts: cold,      // == the load delta
    delta_artifacts: cold.map((c) => c.ref),
  };
}

// ---------- measure (ESTIMATE) ----------

function walkUniverse() {
  const exts = new Set(config.universe.includeExtensions);
  const exclude = new Set(config.universe.excludeBasenames);
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const en of entries) {
      const child = rel + '/' + en.name;
      if (en.isDirectory()) walk(child);
      else if (en.isFile() && exts.has(path.extname(en.name)) && !exclude.has(en.name)) out.push(child);
    }
  };
  config.universe.roots.forEach(walk);
  return out;
}
const estTokens = (bytes) => Math.ceil(bytes / BYTES_PER_TOKEN);

function measure(opts) {
  const universe = walkUniverse();
  const fullTokens = estTokens(universe.reduce((s, r) => s + bytesOf(r), 0));
  const { exec } = manifests();
  const targets = (exec.workflows || []).filter((w) => !opts.workflow || w.id === opts.workflow);
  const rows = [];
  for (const wf of targets) {
    const r = resolve(wf.id, opts);
    if (r.error) continue;
    const minTokens = r.eager_documents.reduce((s, d) => s + estTokens(d.bytes), 0);
    // warm session: only the workflow-specific eager docs are new work (boot is warm)
    const warmTokens = r.eager_documents.filter((d) => !isBootDoc(d.path)).reduce((s, d) => s + estTokens(d.bytes), 0);
    rows.push({
      workflow: wf.id,
      min_tokens: minTokens,
      reduction_pct: fullTokens ? Math.round((1 - minTokens / fullTokens) * 100) : 0,
      warm_reduction_pct: fullTokens ? Math.round((1 - warmTokens / fullTokens) * 100) : 0,
    });
  }
  const avg = (k) => rows.length ? Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length) : 0;
  return { full_documents: universe.length, full_tokens: fullTokens, rows, avg_reduction_pct: avg('reduction_pct'), avg_warm_reduction_pct: avg('warm_reduction_pct') };
}
let _bootSet = null;
function isBootDoc(p) {
  if (!_bootSet) _bootSet = new Set(((manifests().boot || {}).documents || []).map((d) => d.path));
  return _bootSet.has(p);
}

// ---------- validate (correctness only) ----------

function validate() {
  const errors = [];
  const { boot, exec, deps } = manifests();
  if (!boot) errors.push(`BOOT_MANIFEST missing/unparseable at ${P.bootManifest}`);
  if (!exec) errors.push(`EXECUTION_MANIFEST missing/unparseable at ${P.executionManifest}`);
  if (!deps) errors.push(`ARTIFACT_DEPENDENCIES missing/unparseable at ${P.artifactDependencies}`);
  if (errors.length) return errors;

  const checkDocs = (docs, where) => {
    for (const d of docs || []) {
      if (!d.path || !exists(d.path)) errors.push(`${where}: document path does not exist: ${d && d.path}`);
      if (d.load && !['eager', 'lazy'].includes(d.load)) errors.push(`${where}: invalid load mode "${d.load}" for ${d.path}`);
    }
  };
  checkDocs(boot.documents, 'BOOT_MANIFEST');

  const declaredArtifacts = new Set((deps.artifacts || []).map((n) => n.id).filter(Boolean));
  const declaredPrefixes = new Set(Array.from(declaredArtifacts).map(artifactPrefix));
  const knownRef = (ref) => KNOWN_PREFIXES.includes(artifactPrefix(ref)) &&
    (declaredArtifacts.has(ref) || declaredPrefixes.has(artifactPrefix(ref)));

  // every workflow file on disk has exactly one entry; every entry resolves
  const ignore = new Set(config.workflowIgnore || []);
  let onDisk = [];
  try {
    onDisk = fs.readdirSync(path.join(REPO_ROOT, P.workflowsDir))
      .filter((f) => f.endsWith('.md') && !ignore.has(f)).map((f) => f.replace(/\.md$/, ''));
  } catch (e) { errors.push(`cannot read workflows dir ${P.workflowsDir}`); }
  const declared = new Set();
  for (const wf of exec.workflows || []) {
    if (!wf.id) { errors.push('EXECUTION_MANIFEST has a workflow entry without an id'); continue; }
    if (declared.has(wf.id)) errors.push(`duplicate workflow id "${wf.id}"`);
    declared.add(wf.id);
    if (!exists(workflowFile(wf.id))) errors.push(`workflow "${wf.id}" has no file at ${workflowFile(wf.id)}`);
    checkDocs(wf.documents, `workflow ${wf.id}`);
    for (const ref of wf.artifacts || []) {
      if (!knownRef(ref)) errors.push(`workflow "${wf.id}" references unknown/undeclared artifact "${ref}"`);
    }
  }
  for (const id of onDisk) if (!declared.has(id)) errors.push(`workflow "${id}" has no EXECUTION_MANIFEST entry (.claude/workflows/${id}.md)`);

  // dependency edges reference declared artifacts
  for (const node of deps.artifacts || []) {
    if (!node.id) { errors.push('ARTIFACT_DEPENDENCIES has a node without an id'); continue; }
    for (const dep of node.depends_on || []) {
      if (!declaredArtifacts.has(dep)) errors.push(`artifact "${node.id}" depends_on undeclared node "${dep}"`);
    }
  }
  return errors;
}

// ---------- CLI ----------

function parseArgs(argv) {
  const o = { _: [], format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--validate') o.validate = true;
    else if (a === '--measure') o.measure = true;
    else if (a === '--workflow') o.workflow = argv[++i];
    else if (a === '--head') o.head = argv[++i];
    else if (a === '--format') o.format = argv[++i];
    else o._.push(a);
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));

  if (o.validate) {
    const errors = validate();
    if (o.format === 'json') process.stdout.write(JSON.stringify({ errors }, null, 2) + '\n');
    else {
      const L = ['Context Manifest Validation', '='.repeat(27), `Errors: ${errors.length}`];
      errors.forEach((e) => L.push(`[FAIL] ${e}`));
      if (!errors.length) L.push('OK — manifests structurally valid.');
      process.stdout.write(L.join('\n') + '\n');
    }
    process.exit(errors.length ? 1 : 0);
  }

  if (o.measure) {
    const m = measure(o);
    if (o.format === 'json') { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); return; }
    const L = [];
    L.push('Context Loading — ESTIMATED reduction (byte/4 proxy, NOT a tokenizer count)');
    L.push('='.repeat(72));
    L.push(`Naive full load: ${m.full_documents} documents, ~${m.full_tokens} est. tokens`);
    L.push('');
    L.push('Workflow                         est. min tokens   est. reduction   est. warm reduction');
    for (const r of m.rows) {
      L.push(`${r.workflow.padEnd(32)} ${String(r.min_tokens).padStart(15)}   ${String(r.reduction_pct + '%').padStart(13)}   ${String(r.warm_reduction_pct + '%').padStart(19)}`);
    }
    L.push('');
    L.push(`Average estimated minimum-load reduction: ${m.avg_reduction_pct}%`);
    L.push(`Average estimated warm-session reduction: ${m.avg_warm_reduction_pct}%`);
    L.push('(Estimates only — a deterministic byte proxy for relative comparison, not authoritative token counts.)');
    process.stdout.write(L.join('\n') + '\n');
    return;
  }

  if (o._[0] === 'resolve') {
    if (!o.workflow) { process.stderr.write('resolve requires --workflow <id>\n'); process.exit(1); }
    const r = resolve(o.workflow, o);
    if (r.error) { process.stderr.write(r.error + '\n'); process.exit(1); }
    if (o.format === 'json') { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return; }
    const L = [];
    L.push(`Context Resolution — workflow: ${r.workflow}`);
    L.push('='.repeat(40));
    L.push(`framework_version: ${r.framework_version}   baseline_revision: ${r.baseline_revision}`);
    L.push(`boot_context_valid: ${r.boot_context_valid} (key ${r.boot_cache_key})   revision_valid: ${r.revision_valid}`);
    L.push('');
    L.push(`Eager documents (${r.eager_documents.length}):`);
    r.eager_documents.forEach((d) => L.push(`  + ${d.path}${d.exists ? '' : '  [MISSING]'}`));
    if (r.lazy_documents.length) {
      L.push(`Lazy documents — load on demand (${r.lazy_documents.length}):`);
      r.lazy_documents.forEach((d) => L.push(`  ~ ${d.path}`));
    }
    L.push('');
    L.push(`Resolved artifacts (${r.resolved_artifacts.length}): ${r.resolved_artifacts.join(', ')}`);
    L.push(`Warm — reused, not reloaded (${r.warm_artifacts.length}): ${r.warm_artifacts.map((w) => w.ref).join(', ') || '(none)'}`);
    L.push(`Delta to load — cold set (${r.delta_artifacts.length}): ${r.delta_artifacts.join(', ') || '(none — all warm)'}`);
    process.stdout.write(L.join('\n') + '\n');
    return;
  }

  process.stderr.write('usage: context-loader.js resolve --workflow <id> | --measure | --validate  [--format text|json] [--head <rev>]\n');
  process.exit(1);
}

main();
