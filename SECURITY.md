# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include secrets,
tokens, private keys, App/Space data, or exploit details in public discussions.

Report vulnerabilities privately through the repository's GitHub security
advisory form:

<https://github.com/shazhou-ww/unicas/security/advisories/new>

Include the affected component and version or commit, reproduction steps,
security impact, and any suggested mitigation. Use disposable credentials and
non-production environments when a reproduction needs authenticated requests.

The maintainers will acknowledge the report through the private advisory,
coordinate validation and remediation there, and publish details only after a
fix and disclosure plan are ready.

## Supported versions

| Version | Support |
| --- | --- |
| Unreleased `0.2.0` App-user SDK candidate | Evaluated from the `main` source revision |
| Latest `0.1.x` App-user SDK patch | Supported |
| Earlier `0.1.x` patches | Upgrade required before a fix is prepared |
| `0.1.0-beta.1` and older prereleases | Not supported |
| Latest `main` service revision | Evaluated for unreleased service defects |

Package support is limited to the runtime and toolchain matrix documented at
<https://docs.unicas.work/app-user-api/compatibility/>. Retired Stack/Tenant
clients and APIs are not supported.

## Response and disclosure

Maintenance is best-effort rather than an SLA. The maintainers target an
acknowledgement within three business days and an initial assessment within
seven business days. Complex reports, upstream coordination, or maintainer
availability may require more time.

Please keep the report private until maintainers agree on a disclosure plan.
When a supported release is affected, the project will prepare a reviewed fix,
record security impact in the App-user SDK changelog or service release notes,
and use the existing immutable release and provenance process. Published
versions are never silently replaced.