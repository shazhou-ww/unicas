# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** Establish the telemetry safety contract
- [x] **I-S02:** Implement the bounded portable tracing pipeline
- [x] **I-S03:** Instrument the service and Spaces boundaries
- [x] **I-S04:** Document and test the operational contract

### Implementation acceptance criteria

- [x] **I-AC01:** Telemetry excludes prohibited data
- [x] **I-AC02:** Manual tracing is bounded and fail-open
- [x] **I-AC03:** Cross-boundary traces preserve isolation
- [x] **I-AC04:** Current builds keep production export dormant

## Deployment

### Deployment steps

- [ ] **D-S01:** Approve and provision an OTLP destination
- [ ] **D-S02:** Approve a bounded nonzero sample
- [ ] **D-S03:** Deploy and run synthetic canaries
- [ ] **D-S04:** Inspect retention and prove rollback

### Deployment acceptance criteria

- [ ] **D-AC01:** Destination governance is explicit
- [ ] **D-AC02:** Representative waterfalls are useful
- [ ] **D-AC03:** Retained telemetry contains no prohibited values
- [ ] **D-AC04:** Production operation remains bounded and reversible
