# Engineering Lifecycle

```mermaid
flowchart TD
    H[Human objective] --> G0{G0 Pre-flight}
    G0 -->|pass| R[Requirements]
    G0 -->|drift| SH[Self-healing / synchronization]
    SH --> G0
    R --> G1{G1 Requirements}
    G1 --> D[Author specification]
    D --> RV[Freeze review candidate]
    RV --> AR[Architecture review]
    RV --> DR[Dependency review]
    RV --> CR[Consistency review]
    RV --> SR[Security review if applicable]
    RV --> PR[Performance review if applicable]
    AR --> MF[Merge findings and fix]
    DR --> MF
    CR --> MF
    SR --> MF
    PR --> MF
    MF --> G2{G2 Freeze / G4 Reviews}
    G2 --> IP[Implementation plan]
    IP --> G3{G3 Plan review}
    G3 --> IM[Implement in dependency order]
    IM --> G5{G5 Implementation verification}
    G5 --> T[Testing]
    T --> V[Independent validation]
    V --> G6{G6 Quality validation}
    G6 --> G7{G7 Merge readiness}
    G7 --> REL[Release preparation]
    REL --> G8{G8 Human release authorization}
    G8 --> PF[Post-flight]
    PF --> G9{G9 Consistency restored}
    G9 --> LN[Learning: record repeated signals]
    LN -.proposals.-> H

    G1 -->|fail/block| R
    G2 -->|fail/block| D
    G3 -->|fail/block| IP
    G5 -->|fail/block| IM
    G6 -->|fail/block| IM
    G7 -->|drift| SH
    G8 -->|no-go| REL
```

Reviews fan out only after one immutable candidate exists. Validation is independent from both authoring and review. Every gate is a bounded loop with a defined retry policy and termination condition (see [../constitution/LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md)); the learning loop runs after G9 and proposes improvements without mutating policy.
