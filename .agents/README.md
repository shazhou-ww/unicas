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
| `silvermoon` | Packaged canonical | `node_modules/silvermoon/skills` |
| `unicas-cli` | Repository-owned | This repository |
| `unicas-observability` | Repository-owned | This repository |
| `unicas-package-boundaries` | Repository-owned | This repository |

Externally installed skills and the packaged canonical skill are recorded in
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

The Silvermoon package is canonical for its bundled skill. After updating the
dependency and lockfile, refresh only its universal copy:

```sh
npx skills add ./node_modules/silvermoon/skills --skill silvermoon --agent universal --yes --copy
```

Never edit `.agents/skills/silvermoon` directly. Review the dependency,
lockfile, copied skill, and `skills-lock.json` together.

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
ownership metadata, the Silvermoon canonical copy, and mandatory package
routing. The second must discover exactly the skills listed in the ownership
table from `.agents/skills/`; it must not depend on a provider projection.
