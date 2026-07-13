# AI Engineering Platform — Multi-Agent Orchestration Framework

A reusable, documentation-first engineering operating system for orchestrating AI-assisted software development. This framework replaces ad hoc prompting with **structured workflows, independent specialist agents, mandatory review gates, and evidence-based governance**.

The platform establishes deterministic practices for planning, documentation, implementation, testing, validation, review, and release — all coordinated through a formal engineering constitution and synchronized knowledge layer.

**Current Version:** 1.3.0 (Stable)  
**Status:** Production-ready engineering framework  
**Framework Type:** Reusable AI Engineering Operating System

---

## What This Solves

Traditional AI-assisted development relies on:

- Long, manual conversational prompts that drift across sessions
- Repeated repository inspection by multiple agents
- Ad hoc review and approval processes
- Loss of architectural decisions and governance rules
- No audit trail for engineering choices

This platform replaces those with:

- **Documentation-first engineering** — specifications precede all implementation
- **Evidence-based decision making** — repository truth overrides conversation history
- **Specialist autonomy** — independent agents with bounded responsibilities
- **Formal governance** — written constitution defining review gates and merge policies
- **Continuous synchronization** — architecture, dependencies, and rules stay aligned
- **Reusable workflows** — same engineering practices apply across projects

---

## How It Works

### The Core Principle

> **Discover once, freeze to a revision, reuse by reference, invalidate by digest.**

Engineers work through standardized **workflows** (documentation, implementation, review, release). Each workflow:

1. Assembles a minimal context package (objectives, rules, evidence)
2. Routes work to specialist agents with single, clear responsibilities
3. Stops at mandatory gates (G0–G9) where reviewers emit independent findings
4. Synchronizes governance state before proceeding
5. Records what changed and why (audit trail)

No implementation begins from an unfrozen specification. No phase advances on a failed mandatory check.

### Key Artifacts

- **Engineering Constitution** — governance rules, review gates, merge policy, escalation
- **Workflows** — documentation, implementation, testing, validation, review, release, synchronization
- **Registries** — modules, capabilities, loop types, decisions, ownership, state, dependencies
- **Review Gates (G0–G9)** — typed stops with clear owners and evidence requirements
- **Specialist Agents** — Lead Architect, Requirements Analyst, Module Author, Architecture/Dependency/Security/Performance Reviewers, Validator, Release Manager
- **Context Artifacts** — reusable, cached evidence packages (Boot Context, Evidence Package, Dependency Context)

---

## Repository Organization

```
.
├── README.md                               # You are here
├── VERSION.yaml                            # Canonical framework version (1.3.0)
├── CLAUDE.md                               # AI Engineering Platform bootloader & operating model
├── CHANGELOG.md                            # Framework change history
├── FRAMEWORK_RELEASE_NOTES.md              # Detailed release documentation
├── PLATFORM_OPTIMIZATION_PROPOSAL.md       # Token-minimizing context-artifact architecture (1.2.0 design)
│
├── constitution/                           # Governance layer (framework behavior)
│   ├── ENGINEERING_CONSTITUTION.md         # Written governance rules (articles 1–20)
│   ├── SOURCE_OF_TRUTH.md                  # Authority hierarchy (what overrides what)
│   ├── REVIEW_GATES.md                     # Gate definitions G0–G9, owners, applicability
│   ├── REVIEWER_FINDINGS.md                # Canonical finding schema (confidence, unknowns)
│   ├── LOOP_CONTROL.md                     # Loop types, bounds, termination rules
│   └── CONTEXT_ARTIFACTS.md                # Reusable artifact definitions (v1.2.0+)
│
├── workflows/                              # Standardized engineering workflow library
│   ├── README.md                           # Workflow reference index & artifact ID registry
│   ├── preflight.md                        # Pre-flight gate (G0): readiness checks
│   ├── requirements.md                     # Requirements gate (G1): intake & acceptance
│   ├── documentation.md                    # Documentation workflow (writing & review cycles)
│   ├── implementation.md                   # Implementation workflow (coding & validation)
│   ├── testing.md                          # Testing workflow
│   ├── validation.md                       # Validation gate (G6): acceptance proof
│   ├── architecture-review.md              # Architecture gate (G4): design approval
│   ├── dependency-review.md                # Dependency gate (G5): graph consistency
│   ├── consistency-review.md               # Consistency gate (G7): cross-module alignment
│   ├── security-review.md                  # Security gate (G8): threat/compliance review
│   ├── performance-review.md               # Performance gate (G9): efficiency validation
│   ├── boundary-collision.md               # Pre-authoring gate (G1.5): ownership conflict detection
│   ├── repository-synchronization.md       # Discovery & evidence packaging
│   ├── foundation-synchronization.md       # Knowledge base sync
│   ├── dependency-synchronization.md       # Dependency graph sync
│   ├── release.md                          # Release workflow (versioning, tagging, notes)
│   ├── learning.md                         # Continuous improvement loop
│   ├── postflight.md                       # Post-flight gate: handoff & sync
│   └── self-healing.md                     # Self-consistency enforcement
│
├── knowledge/                              # Project-specific facts & indices (repository context)
│   ├── README.md                           # Knowledge layer overview
│   ├── PROJECT_PROFILE.md                  # Project goals, constraints, stakeholders
│   ├── MODULE_REGISTRY.yaml                # All modules, ownership, contracts
│   ├── DEPENDENCY_GRAPH.yaml               # Full dependency graph (internal + external)
│   ├── OWNERSHIP_INDEX.yaml                # Owners per module, area, decision
│   ├── STATE_OWNERSHIP_INDEX.yaml          # State object owners, mutation rules
│   ├── CONTRACT_INDEX.yaml                 # API contracts, event schemas, version policies
│   ├── BOUNDARY_INDEX.yaml                 # Module boundaries, no-cross zones
│   ├── API_INDEX.yaml                      # Endpoint registry, deprecation tracking
│   ├── CAPABILITY_REGISTRY.yaml            # Platform capabilities & responsible agents
│   ├── LOOP_REGISTRY.yaml                  # Registered workflow loops & metadata
│   ├── SPECIFICATION_INDEX.yaml            # Module specs, versions, owners
│   ├── DECISION_INDEX.md                   # Architecture Decision Records (ADRs)
│   ├── TERMINOLOGY.md                      # Project-specific terms & abbreviations
│   ├── SYNC_STATE.yaml                     # Last-known state, invalidators, blocks
│   ├── SESSION_STATE.yaml                  # Session-specific context & caches (v1.2.0+)
│   ├── MODULE_MEMORY.yaml                  # Per-module learnings & patterns
│   └── IMPROVEMENT_LOG.yaml                # Continuous improvement signal log
│
├── governance/                             # Governance oversight layer (declarative policies)
│   └── SPECIFICATION_ISSUES_REGISTER.md    # Single index of unresolved issues (v1.3.0+)
│
├── agents/                                 # Specialist agent contracts (reusable)
│   └── [Agent contracts by responsibility: Lead Architect, Reviewers, Author, Validator]
│
├── prompts/                                # Reusable prompt templates (framework policy)
│   └── [Agent-specific prompts: structured inputs & expected outputs]
│
├── templates/                              # Reusable artifact templates
│   └── [Specification, review, decision record, risk assessment templates]
│
├── checklists/                             # Validation & review checklists
│   └── [Architecture, dependency, consistency, security, performance, merge, release]
│
└── diagrams/                               # Visual aids (architecture, flows, dependencies)
    └── [Workflow diagrams, module dependency graphs, gate ownership map]
```

---

## Getting Started

### 1. Understand the Operating Model

1. **Read the bootloader** ([CLAUDE.md](CLAUDE.md)) — explains how to enter workflows and load context.
2. **Read the constitution** ([constitution/ENGINEERING_CONSTITUTION.md](constitution/ENGINEERING_CONSTITUTION.md)) — governance rules you'll follow.
3. **Understand your project** — check [knowledge/PROJECT_PROFILE.md](knowledge/PROJECT_PROFILE.md) for objectives, constraints, and team.

### 2. Start a Workflow

All engineering work routes through one of the standardized workflows:

| Phase        | Workflow                                                                 | Trigger              | Owner                 | Gate(s)              |
| ------------ | ------------------------------------------------------------------------ | -------------------- | --------------------- | -------------------- |
| **Intake**   | [requirements.md](workflows/requirements.md)                             | User objective       | Requirements Analyst  | G0, G1               |
|              | [documentation.md](workflows/documentation.md)                           | Specification needed | Module Author         | G0, G1.5, G2, G4, G6 |
| **Delivery** | [implementation.md](workflows/implementation.md)                         | Code delivery        | Engineer              | G0, G1.5, G3, G5     |
|              | [testing.md](workflows/testing.md)                                       | QA phase             | QA Engineer           | Test gate            |
|              | [validation.md](workflows/validation.md)                                 | Acceptance proof     | Validator             | G6                   |
| **Reviews**  | [architecture-review.md](workflows/architecture-review.md)               | Design audit         | Architecture Reviewer | G4                   |
|              | [dependency-review.md](workflows/dependency-review.md)                   | Graph consistency    | Dependency Reviewer   | G5                   |
|              | [security-review.md](workflows/security-review.md)                       | Threat assessment    | Security Reviewer     | G8                   |
| **Sync**     | [repository-synchronization.md](workflows/repository-synchronization.md) | State drift detected | Lead Architect        | Pre-flight           |
| **Release**  | [release.md](workflows/release.md)                                       | Ready to ship        | Release Manager       | G9                   |

### 3. Load Your Context

Every workflow starts by assembling a **context package**:

- Objective (1 paragraph)
- Applicable rules (from constitution)
- Repository evidence (from synchronization)
- Relevant specifications
- Architecture decisions
- Dependencies
- Acceptance criteria

See [constitution/CONTEXT_ARTIFACTS.md](constitution/CONTEXT_ARTIFACTS.md) for caching and reuse rules (v1.2.0+).

### 4. Know Your Gates

Work stops at **mandatory gates** — read-only checkpoints with clear owners and evidence requirements.

| Gate                          | Typical Owner         | Entry              | Exit                                |
| ----------------------------- | --------------------- | ------------------ | ----------------------------------- |
| **G0** (Pre-flight)           | Lead Architect        | Readiness check    | Evidence of readiness or escalation |
| **G1** (Requirements)         | Requirements Analyst  | Intake             | Frozen acceptance criteria          |
| **G1.5** (Boundary Collision) | Lead Architect        | Before authoring   | No ownership conflicts or stop      |
| **G2** (Documentation Freeze) | Architecture Reviewer | Spec review        | Specification ratified              |
| **G3** (Implementation)       | Module Author         | Code ready         | Code review complete                |
| **G4** (Architecture)         | Architecture Reviewer | Design audit       | Design approved                     |
| **G5** (Dependency)           | Dependency Reviewer   | Graph check        | No graph violations                 |
| **G6** (Validation)           | Validator             | Acceptance test    | All criteria met                    |
| **G7** (Consistency)          | Consistency Reviewer  | Cross-module check | No inconsistencies                  |
| **G8** (Security)             | Security Reviewer     | Threat assessment  | No unaccepted risks                 |
| **G9** (Performance)          | Performance Reviewer  | Efficiency check   | Acceptable performance              |

See [constitution/REVIEW_GATES.md](constitution/REVIEW_GATES.md) for the full gate map.

### 5. Synchronize State

Before merging or releasing, always check:

- [knowledge/SYNC_STATE.yaml](knowledge/SYNC_STATE.yaml) — blocks, decisions, pending items
- [governance/SPECIFICATION_ISSUES_REGISTER.md](governance/SPECIFICATION_ISSUES_REGISTER.md) — known unresolved issues

If you modify specifications or architecture, update the relevant registry:

- [knowledge/MODULE_REGISTRY.yaml](knowledge/MODULE_REGISTRY.yaml)
- [knowledge/DEPENDENCY_GRAPH.yaml](knowledge/DEPENDENCY_GRAPH.yaml)
- [knowledge/OWNERSHIP_INDEX.yaml](knowledge/OWNERSHIP_INDEX.yaml)

---

## Key Concepts

### Documentation-First Development

No code is written until its specification is frozen. Specifications are reviewed independently:

- Requirements → Architecture → Dependency → Consistency → Security → Performance
- Each reviewer examines the spec against their gate criteria
- Findings are merged; author corrects; affected reviewers re-review (not all)
- Only on gate pass does implementation begin

### Evidence-Based Decision Making

The repository is the source of truth:

- Architecture is recorded in Decision Index ([knowledge/DECISION_INDEX.md](knowledge/DECISION_INDEX.md))
- Ownership is declared in registries ([knowledge/OWNERSHIP_INDEX.yaml](knowledge/OWNERSHIP_INDEX.yaml))
- Dependencies are graphed ([knowledge/DEPENDENCY_GRAPH.yaml](knowledge/DEPENDENCY_GRAPH.yaml))
- Conversation history is subordinate to written evidence

### Specialist Autonomy with Oversight

Each specialist agent:

- Owns one clear responsibility
- Receives minimal context (only what they need)
- Emits structured findings ([constitution/REVIEWER_FINDINGS.md](constitution/REVIEWER_FINDINGS.md))
- Works independently until synchronization (no pre-SYNC coordination)

The Lead Architect:

- Does not perform specialist reviews
- Orchestrates workflow transitions
- Resolves conflicts (ties in decision trees)
- Manages context caching and invalidation

### Mandatory Review Gates

All work stops at gates until reviewers confirm:

- Frozen specifications don't violate requirements
- Implementation doesn't violate specifications
- Architecture doesn't violate constraints
- Dependencies don't introduce cycles or conflicts
- Security doesn't miss threat models
- Performance meets acceptance criteria

Blocker findings (Critical/High) require resolution or formal risk acceptance.

### Continuous Synchronization

State is synchronized at:

- Pre-flight (readiness)
- Post-flight (handoff)
- Every review gate (findings merge)
- Release (version, tags, notes)

See [workflows/repository-synchronization.md](workflows/repository-synchronization.md).

---

## Version & Release Notes

**Current Version:** 1.3.0 (Stable, 2026-07-09)

### Recent Releases

- **1.3.0** — Specification Issues Register (governance layer, unresolved issue tracking)
- **1.2.0** — Context Artifacts & Token Optimization (caching, incremental review, boundary collision gate)
- **1.1.0** — Platform Audit Improvements (bounded loops, capability registry, learning loop)
- **1.0.0** — Foundation (initial platform release)

See [VERSION.yaml](VERSION.yaml), [CHANGELOG.md](CHANGELOG.md), and [FRAMEWORK_RELEASE_NOTES.md](FRAMEWORK_RELEASE_NOTES.md) for full history.

---

## For AI Agents

### Bootloader Entry Point

Every agent task begins with:

```
0. Load Boot Context (ART-BOOT-001) from VERSION.yaml.current_version
1. Read ENGINEERING_CONSTITUTION.md
2. Resolve truth with SOURCE_OF_TRUTH.md
3. Run Pre-flight Workflow (workflows/preflight.md)
4. Select applicable workflow + owner
5. Stop at every required gate; collect independent findings
6. Finish with Post-flight Workflow (workflows/postflight.md)
```

See [CLAUDE.md](CLAUDE.md) for the full boot sequence and context assembly rules.

### Agent Contracts

Specialist agents live in [agents/](agents/) and receive a **Context Package** (not the full repository):

- Objective
- Applicable rules (pointers to constitution)
- Evidence (revision-bound artifact references)
- Acceptance criteria
- Output contract (finding schema)

See [constitution/CONTEXT_ARTIFACTS.md](constitution/CONTEXT_ARTIFACTS.md) §6.4 for the Context Package structure.

### Knowledge Separation

- **Framework policy** (reusable) → [.claude/](/)
- **Project knowledge** (repository-specific) → [knowledge/](knowledge/)
- **Governance oversight** (policy declarations) → [governance/](governance/)

Never mix reusable policy with project facts. Instances of context artifacts are revision-bound runtime state.

---

## For Humans

### Governance Authority

The platform escalates to you:

- Architecture Decision Record ratification ([constitution/ENGINEERING_CONSTITUTION.md](constitution/ENGINEERING_CONSTITUTION.md) §20)
- Module ownership assignment ([knowledge/OWNERSHIP_INDEX.yaml](knowledge/OWNERSHIP_INDEX.yaml))
- Review gate modifications ([constitution/REVIEW_GATES.md](constitution/REVIEW_GATES.md))
- Engineering Constitution amendments
- Risk acceptance (Critical/High blocker findings)

### How to Interact

1. **Read the objective** — the current workflow's goal
2. **Inspect evidence** — findings, architecture decisions, state changes
3. **Approve or reject** — explicit governance decision required
4. **Record your decision** — adds to audit trail

See [knowledge/DECISION_INDEX.md](knowledge/DECISION_INDEX.md) for all past decisions.

---

## Advanced: Token Optimization (v1.2.0+)

The platform implements **context-artifact caching** to reduce token consumption by 45–65%:

- **Boot Context** (`ART-BOOT-001`) — framework policy cached per version
- **Evidence Package** (`ART-EVID-001`) — repository discovery cached per revision
- **Dependency Context** (`ART-DEPCTX-*`) — sliced dependency graphs cached
- **Incremental Correction** — only affected reviewers rerun after corrections

See [PLATFORM_OPTIMIZATION_PROPOSAL.md](PLATFORM_OPTIMIZATION_PROPOSAL.md) for the design.

---

## FAQ

**Q: Why documentation-first?**
A: Specs are cheaper to review and revise than code. Frozen specs prevent rework.

**Q: What if I disagree with a gate decision?**
A: Escalate to the next authority level. Risk acceptance requires human approval for blockers.

**Q: How do I add a new module?**
A: Start [workflows/documentation.md](workflows/documentation.md) → write spec → pass G2 (freeze) → update [knowledge/MODULE_REGISTRY.yaml](knowledge/MODULE_REGISTRY.yaml) and [knowledge/DEPENDENCY_GRAPH.yaml](knowledge/DEPENDENCY_GRAPH.yaml).

**Q: Can I skip a gate?**
A: No. Every gate is mandatory for its applicable workflow. Skipping requires Constitution §20 (human approval).

**Q: What happens if a gate fails?**
A: Findings are merged, author corrects, affected reviewers re-review. If Critical/High findings remain unresolved, merge is blocked.

**Q: How do I know what changed?**
A: Check [knowledge/SYNC_STATE.yaml](knowledge/SYNC_STATE.yaml) and the workflow's output artifacts. Every change is recorded with ownership and rationale.

---

## Learn More

- **Operating Model:** [CLAUDE.md](CLAUDE.md)
- **Governance:** [constitution/ENGINEERING_CONSTITUTION.md](constitution/ENGINEERING_CONSTITUTION.md)
- **Workflows:** [workflows/README.md](workflows/README.md)
- **Knowledge Layer:** [knowledge/README.md](knowledge/README.md)
- **Review Gates:** [constitution/REVIEW_GATES.md](constitution/REVIEW_GATES.md)
- **Decisions:** [knowledge/DECISION_INDEX.md](knowledge/DECISION_INDEX.md)

---

## Contributing

This platform is reusable. When you add to it:

1. Update [knowledge/SYNC_STATE.yaml](knowledge/SYNC_STATE.yaml) with your change
2. Check [governance/SPECIFICATION_ISSUES_REGISTER.md](governance/SPECIFICATION_ISSUES_REGISTER.md) for related open issues
3. Run the learning loop (workflows/learning.md) to capture signals
4. Increment the version in [VERSION.yaml](VERSION.yaml) if you change framework policy

---

**Status:** Stable | **License:** See repository | **Maintained by:** Mayank Kothawale
