# Repository ideas

This repository uses the device-level `silvermoon` runtime and personal skill
link, the shared
[Silvermoon configuration](/.silvermoon/config.yaml), and the fixed
`.silvermoon/ideas/` layout for explicitly managed long-running outcomes.
Ordinary implementation requests do not create an idea unless the user opts
into the lifecycle.

## Installation

Install a schema-v2-capable runtime once per device, outside this repository,
and register its canonical skill through the personal discovery link:

```sh
npm install --global silvermoon@0.5.0-canary.50.g7e6b2e80af33
silvermoon-link-skill
```

The exact published canary supports the current timestamped, sequence-optional
event grammar. Stable 0.4.0 uses an older v2 record grammar and cannot validate
these logs. Do not rewrite event history to accommodate an older validator or
use a moving canary tag in CI. The linking command registers the installation's
canonical skill in personal discovery; snapshot-only CI checks do not need it.

Do not install the runtime as a repository dependency or copy its skill into
the repository. Snapshot-only CI checks install the same global runtime;
they do not require a personal skill registration.
See [Agent guidance](../.agents/README.md) for skill ownership.
The repository configuration names the
credential-free canonical HTTPS repository and `main` as the shared primary.

## Layout

Each idea uses an immutable uppercase ULID and may have one unique alias:

```text
.silvermoon/
|-- config.yaml
`-- ideas/
    `-- <ULID>/
        |-- events.jsonl
        |-- ledger.md
        `-- outer/
            |-- Deployment.md
            `-- inner/
                |-- Implementation.md
                `-- ideal/
                    `-- Idea.md
```

`Idea.md` defines the desired outcome. `Implementation.md` defines repository
work and its proof. `Deployment.md` defines external rollout and verification.
Supporting artifacts stay in the world they support. The root ledger mirrors
stable step and acceptance-criterion IDs as Agent-owned checkboxes.

## Workflow

- Use `silvermoon create-idea --audience agent` only after an explicit
  creation request. It creates an untracked scaffold and never records
  approval.
- Use
  `silvermoon whats-next [ULID-or-alias] --audience agent`
  to observe readiness and obtain the next ordered action. Bare navigation
  never selects an idea.
- Publish normal non-force commits through the repository's standard path.
  Reobserve after repository or external state changes.
- After synchronizing a completed world to primary, use `silvermoon event append`
  to record its exact `submitIdeal`, `submitInner`, or `submitOuter`.
  Record the corresponding `acceptIdeal`, `acceptInner`, or `acceptOuter` only
  after an explicit human decision for that exact submitted world revision.
  Bind each append to the observed event digest and primary commit; never edit
  `events.jsonl` by hand or infer decisions from submissions.
- Keep approval and acceptance out of ledger checkboxes. Those checkboxes are
  operational memory for Agent work only.
- Preserve concurrent work and history. Never force-push, reset, broadly clean,
  or replay a stale decision onto a changed world.

## Validation

Use the snapshot matching the candidate being reviewed:

```sh
pnpm check:ideas
silvermoon check --staged --audience agent
pnpm check:ideas:commit
pnpm check:ideas:remote
```

`pnpm check:ideas` validates the complete worktree candidate. Before committing,
validate the staged snapshot; after synchronizing to primary, run
`pnpm check:ideas:remote` explicitly against refreshed primary history.
Ordinary `main` pushes do not start hosted validation.

CI explicitly normalizes its ephemeral `origin` URL to the configured canonical
HTTPS repository including `.git`, and fetches `main` into
`refs/remotes/origin/main` before worktree history checks. The validator matches
named remotes by exact canonical URL; a checkout URL without `.git` is not a
valid primary baseline even if it identifies the same GitHub repository.

## Documentation boundary

Keep idea-specific plans, evidence, and continuation state in the appropriate
idea world. Reserve `docs/` for accepted, stable architecture, terminology,
protocol, operations, and configuration consensus. Never store credentials,
tokens, private keys, or private customer data in ideas or documentation.
