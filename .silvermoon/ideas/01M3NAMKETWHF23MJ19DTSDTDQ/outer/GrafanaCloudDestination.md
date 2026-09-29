# Grafana Cloud destination review

This is supporting Outer World evidence for D-S01 and D-AC01. It records only
non-sensitive governance and configuration facts. It does not contain account
identifiers, credentials, or authorization header values.

Reviewed on 2026-09-29.

## Decision boundary

- Grafana Cloud is approved as the candidate OTLP destination for synthetic
  deployment validation.
- This review does not authorize a nonzero production sample, a Cloudflare
  secret change, a Worker deployment, or a paid Grafana plan.
- Cloudflare automatic tracing remains disabled. Only the reviewed manual
  OTLP/HTTP exporter may eventually send traces.

## Destination and residency

- Product: Grafana Cloud Traces in a single stack.
- Region: Singapore on AWS `ap-southeast-1`.
- Credential-free OTLP/HTTP traces endpoint:
  `https://otlp-gateway-prod-ap-southeast-1.grafana.net/otlp/v1/traces`.
- Grafana's regional availability documentation identifies AWS
  `ap-southeast-1` as Singapore and states that an existing stack cannot change
  region.

## Ownership and access

- The UniCAS maintainers own the destination lifecycle, policy management,
  credential rotation and revocation, and first incident response.
- Trace readers are restricted to Grafana organization administrators.
- A read-only Grafana organization query on 2026-09-29 returned one Admin and
  no Editor or Viewer members. Membership must be rechecked before a nonzero
  production sample is approved.
- The stack-scoped access policy is `unicas-manual-traces-ingest`. It is active
  in the Singapore realm and grants only `traces:write`.

## Credential handling

- A token named `unicas-cloudflare-prod-traces` was created under the dedicated
  access policy with a 90-day expiry.
- The raw token is stored only as `cfg:GRAFANA_ACCESS_TOKEN`; its value was not
  copied into the repository, browser transcript, or review record.
- The corresponding numeric instance ID is stored only as
  `cfg:GRAFANA_INSTANCE_ID`; its value is not recorded here.
- Access to both values is limited to approved UniCAS deployment maintainers.
- No Cloudflare Worker secret has been changed or provisioned yet.
- Rotation creates a replacement token under the same policy, updates the
  approved secret store and later Worker secrets, validates a synthetic trace,
  and then revokes the old token. Emergency response revokes the current token
  immediately.

## Retention, deletion, and cost

- The account is currently in Grafana's 14-day unlimited-usage trial. Grafana's
  billing documentation states that trial usage is not billed and the account
  automatically moves to the Free plan afterward.
- During the trial, only synthetic non-sensitive traces may be sent and up to
  the documented paid default of 30 days of trace retention is accepted.
  Production sampling remains zero.
- The approved steady-state target is the Free plan's 14-day minimum trace
  retention. The effective stack retention and current instance limits must be
  inspected again after the Free transition and before any nonzero production
  sample.
- No payment method or paid upgrade is authorized. If a Free limit rejects or
  discards traces, the loss of diagnostics is accepted; purchasing capacity
  requires a separate explicit decision.
- Normal deletion is automatic at the effective retention boundary. If
  sensitive information is accidentally retained, the response is to restore
  sample zero and redeploy if tracing was active, revoke the ingest token, fix
  the source, and have a Grafana organization administrator request deletion
  from Grafana Support by time range and Trace ID or TraceQL query. The UniCAS
  maintainers track the request through closure.

## Failure and incident behavior

- Export remains bounded to one concurrent OTLP request with a one-second
  timeout and fails open after the business response.
- Grafana timeout, unavailability, authentication failure, throttling, or
  quota rejection can lose traces but must not fail a UniCAS request.
- Traces are diagnostic samples, not availability, billing, or SLO evidence.
- Persistent export failure, unexpected volume, or a data-safety concern
  triggers sample-zero rollback, credential revocation or rotation as
  applicable, and UniCAS maintainer incident handling.

## Synthetic connectivity evidence

On 2026-09-29, one local synthetic canary used the reviewed UniCAS OTLP
exporter and the approved Grafana destination. The Basic authorization value
was constructed in memory from the two approved `cfg` entries; neither source
value nor the resulting header was printed or written to disk.

- The OTLP exporter callback reported success.
- A read-only Tempo lookup returned one `unicas.request` root and one
  `unicas.fetch` child with the expected parent relationship.
- Retained resource fields were limited to synthetic `service.name` and
  `service.version` values.
- Retained span fields were limited to the synthetic correlation ULID,
  operation, peer, outcome, and HTTP status class values allowed by the
  repository contract.
- The canary used no Worker, Cloudflare binding, customer identifier,
  credential, request content, storage key, URL, SQL, or provider error.

This proves destination authentication, OTLP compatibility, and retention for
one synthetic shape only. It does not prove the representative Worker
waterfalls or comprehensive retained-field review required by D-AC02 and
D-AC03.

## Evidence sources

- Grafana Cloud regional availability:
  <https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/account-management/regional-availability/>
- Grafana Cloud trace pricing and retention:
  <https://grafana.com/docs/grafana-cloud/platform/pricing-and-usage/traces/>
- Grafana Cloud trial billing behavior:
  <https://grafana.com/docs/grafana-cloud/cost-management-and-billing/understand-your-invoice/>
- Grafana Cloud trace deletion requests:
  <https://grafana.com/docs/grafana-cloud/send-data/traces/remove-trace-info/>
- Grafana Cloud access policies:
  <https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/>

## Remaining gates

At the time of this review:

- The accepted Implementation now provides a protected, shared production
  activation path for both Workers, but no nonzero profile has been
  provisioned through it.
- No exact nonzero production sample has been proposed or approved.
- No destination credential has been provisioned to either Cloudflare Worker.
- No Worker has been deployed, and no representative cross-path canary,
  effective-limit check, or rollback exercise has been performed.
