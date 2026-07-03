# Dependency Knowledge Model

```mermaid
erDiagram
    MODULE ||--o{ DEPENDENCY_EDGE : "source or target"
    MODULE ||--o{ CONTRACT : owns
    MODULE ||--o{ EVENT : publishes
    MODULE ||--o{ EVENT_CONSUMPTION : consumes
    EVENT ||--o{ EVENT_CONSUMPTION : has
    MODULE ||--o{ STATE_DOMAIN : owns
    CONTRACT ||--o{ DEPENDENCY_EDGE : governs
    OWNER ||--o{ MODULE : accountable_for
    OWNER ||--o{ CONTRACT : accountable_for

    MODULE {
      string id
      string path
      string status
      string owner_id
    }
    DEPENDENCY_EDGE {
      string id
      string source
      string target
      string kind
      string contract_id
      string compatibility
      string evidence
    }
    CONTRACT {
      string id
      string version
      string owner_module
      string source
    }
    EVENT {
      string id
      string version
      string publisher
      string source
    }
    EVENT_CONSUMPTION {
      string event_id
      string consumer
      string evidence
    }
    STATE_DOMAIN {
      string id
      string writer_module
      string source
    }
    OWNER {
      string id
      string authority_source
    }
```

To calculate synchronization scope, traverse changed nodes/edges in both directions, include contract/event/state owners, then stop only after all reachable active consumers are classified.
