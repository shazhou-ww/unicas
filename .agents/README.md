# Agent guidance

`.agents/` is the only supported canonical root for repository Agent skills and
reusable instructions. The root [AGENTS.md](../AGENTS.md) contains global
constraints and mandatory routing only; skill bodies live once under
`.agents/skills/<skill-name>/`.

Use the universal target when an installer manages a skill. Do not create,
copy, symlink, install, or require provider-specific projections. In
particular, Claude discovery is not a supported repository surface.

## Skill ownership

| Skill | Ownership | Source of truth |
| --- | --- | --- |
| `business-data-model-review` | Externally installed | `shazhou-ww/skills` |
| `ui-change-review` | Externally installed | `shazhou-ww/skills` |
| `silvermoon` | Device-owned, not copied into this repository | Global runtime's canonical personal skill link |
| `unicas-cli` | Repository-owned | This repository |
| `unicas-observability` | Repository-owned | This repository |
| `unicas-package-boundaries` | Repository-owned | This repository |

Externally installed repository skills are recorded in
[skills-lock.json](../skills-lock.json). Repository-owned skills are maintained
directly in Git and must not be added to that lock.

## Update installed skills

Install or restore each externally managed shared skill into the universal
location with the skills CLI:

```sh
npx skills add shazhou-ww/skills --skill business-data-model-review --agent universal --yes --copy
npx skills add shazhou-ww/skills --skill ui-change-review --agent universal --yes --copy
```

Use the CLI for later updates or removals so the copied skill and
`skills-lock.json` change together:

```sh
npx skills update business-data-model-review ui-change-review --project --yes
npx skills remove <skill-name> --yes
```

Silvermoon is installed once per device or CI host, outside this repository.
Register its canonical skill by personal link rather than copying it:

```sh
npm install --global silvermoon@0.5.0
silvermoon-link-skill
```

Do not add Silvermoon to repository dependencies or `skills-lock.json`, copy
its skill into the repository, or resolve its CLI from local `node_modules`.
Snapshot-only CI checks need the global runtime, not a personal skill link.

Repository-owned skills have no installer source. Edit and review them directly
under `.agents/skills/`, keeping their frontmatter name equal to the directory
name.

## Validate

Run the focused guard after changing Agent guidance:

```sh
pnpm check:agent-guidance
npx skills list --json
```

The first command validates canonical placement, frontmatter, local links,
ownership metadata, Silvermoon's device boundary, and mandatory package
routing. The second discovers the repository-owned and externally installed
repository skills from `.agents/skills/`; the device-owned Silvermoon skill is
discovered separately through the personal link.
