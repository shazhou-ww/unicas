# Repository ideas

This repository uses the installed
[`silvermoon`](/.agents/skills/silvermoon/SKILL.md), the shared
[Silvermoon configuration](/.silvermoon/config.yaml), and the fixed
`.silvermoon/ideas/` layout for explicitly managed long-running outcomes.
Ordinary implementation requests do not create an idea unless the user opts
into the lifecycle.

## Installation

Silvermoon is a root development dependency. Its canonical skill is copied
from the installed package and recorded in `skills-lock.json`:

```sh
npx skills add ./node_modules/silvermoon/skills --skill silvermoon --agent universal --yes --copy
```

Review updates to the dependency, lockfile, installed skill, and skill lock
together. See [Agent guidance](../.agents/README.md) for the repository-wide
skill ownership and update policy. The repository configuration names the
credential-free canonical HTTPS repository and `main` as the shared primary.

## Layout

Each idea uses an immutable uppercase ULID and may have one unique alias:

```text
.silvermoon/
|-- config.yaml
`-- ideas/
    `-- <ULID>/
        |-- status.yaml
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

- Use `pnpm exec silvermoon create-idea` only after an explicit creation
  request. It creates an untracked scaffold and never records approval.
- Use `pnpm exec silvermoon whats-next [ULID-or-alias]` to observe readiness and
  obtain the next ordered action. Bare navigation never selects an idea.
- Publish normal non-force commits through the repository's standard path.
  Reobserve after repository or external state changes.
- Record `approvedRevision`, `implementationAcceptedRevision`, or
  `deploymentAcceptedRevision` only after an explicit human decision for the
  exact reported world revision.
- Keep approval and acceptance out of ledger checkboxes. Those checkboxes are
  operational memory for Agent work only.
- Preserve concurrent work and history. Never force-push, reset, broadly clean,
  or replay a stale decision onto a changed world.

## Validation

Use the snapshot matching the candidate being reviewed:

```sh
pnpm check:ideas
pnpm exec silvermoon check --staged
pnpm check:ideas:commit
pnpm check:ideas:remote
```

`pnpm check:ideas` validates the complete worktree candidate. CI validates the
checked-out commit during normal validation and separately checks refreshed
primary history after a push to `main`.

## Documentation boundary

Keep idea-specific plans, evidence, and continuation state in the appropriate
idea world. Reserve `docs/` for accepted, stable architecture, terminology,
protocol, operations, and configuration consensus. Never store credentials,
tokens, private keys, or private customer data in ideas or documentation.
