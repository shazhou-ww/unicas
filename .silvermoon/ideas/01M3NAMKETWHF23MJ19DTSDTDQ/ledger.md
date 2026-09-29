# Ledger

Checked items record completed Agent work and valid evidence only. They do not
record Ideal approval, implementation acceptance, deployment acceptance, or
authorization to select a destination, enable nonzero sampling, or deploy.

## Revalidation

Reviewed on 2026-09-29 against primary baseline
`82c96944384c30fc1076a43726df7066231959f2`.

### Implemented with current evidence

- The reviewed telemetry baseline (`fb3123872b9162886287eabccbdde6597310afec`),
  manual tracing implementation
  (`06c41a6bf3d0420feae54f31aad7aa602a44e4e7`), review publication
  (`ab35b3fceae702d51405ca808de9e7274178605d`), and Silvermoon migration
  (`3ddcfd080c5eadba78b55a4da6ba9da8890ff1c0`) are all reachable from the
  reviewed primary.
- The tracing implementation, production Worker configurations, and primary
  observability contract have not changed since the manual tracing
  implementation. Both dynamic Workers still disable native tracing and set
  `UNICAS_MANUAL_TRACE_SAMPLE_RATE=0`; repository search finds no checked-in
  OTLP destination, authorization secret, or trace HMAC key.
- Current Cloudflare [tracing](https://developers.cloudflare.com/workers/observability/traces/),
  [span and attribute](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/),
  [known limitation](https://developers.cloudflare.com/workers/observability/traces/known-limitations/),
  and [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
  documentation was rechecked on 2026-09-29. It still lists automatic URL, D1
  SQL, KV key/metadata, R2 key/metadata, Durable Object identity, and Durable
  Object SQL/binding attributes without a documented per-attribute
  pre-persistence redaction control. Tracing remains open beta, and the
  documented 3/7-day retention and 2026-10-01 shared observability event
  pricing still match the repository contract.
- Current focused evidence passed: deployment-policy tests 37/37,
  `@unicas/observability` 20/20, service tracing tests 53/53, Spaces Worker
  tests 14/14, the four affected package typechecks, and documentation tests
  7/7. The first cold documentation run hit its existing 30-second setup
  timeout; an immediate rerun of the unchanged command passed.
- The service build plus direct Wrangler dry run and the Spaces build plus
  Wrangler dry run both passed and reported manual sample `0`.

### Historical evidence and lifecycle boundary

- The files under
  [`outer/inner/legacy-repoledger/`](./outer/inner/legacy-repoledger/) preserve
  the prior task evidence. Git records six files as 100% renames; the retained
  `Task.md` differs only by replacing a link to the now-completed App-user v1
  task with equivalent prose.
- Prior Repoledger scope, interface, and architecture approvals remain
  historical context only. `status.yaml` intentionally contains no
  `approvedRevision`, `implementationAcceptedRevision`, or
  `deploymentAcceptedRevision`.
- The current Ideal contract itself did not require correction during this
  review. Silvermoon still reports `preparing` and requires explicit approval
  of exact Ideal revision
  `53803c529f152bce1a487ecf3c8fe9afcfcdaad3` before implementation acceptance
  can be considered.

### Still outstanding

- No OTLP destination has been selected, reviewed, or provisioned.
- No nonzero production sample rate has been proposed or approved.
- No production deployment, retained synthetic canary, retained-field
  inspection, destination operations evidence, or rollback exercise has been
  performed.
- Every Deployment step and criterion below therefore remains unchecked.

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
