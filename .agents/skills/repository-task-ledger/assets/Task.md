# Task title

Created: YYYY-MM-DD

## Goal

One testable outcome.

## Context

Why the task exists and the current behavior.

## Scope

- Included change.

## Out of scope

- Explicit non-goal.

## Acceptance criteria

- [ ] Observable completion condition.

## Constraints

- Compatibility, security, sequencing, and rollback constraints.

## Human review checkpoints

Task creation records this plan, not approval. Scope alignment and delivery
acceptance are always required for completed work. For each other checkpoint,
replace the placeholder with `Required`, `Not applicable: <reason>`, or
`Assess during execution: <decision trigger>`. For required or assessment
rows, name the reviewer, the concrete artifact they will review, and the work
that approval unlocks. For a not-applicable row, replace the remaining cells
with `Not applicable`. Reorder the middle checkpoints when task dependencies
require a different sequence.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | User or accountable owner | Goal, scope, out of scope, constraints, and acceptance criteria. | Substantive implementation. |
| Interface | `<Required, Not applicable: reason, or Assess during execution: trigger>` | `<Reviewer or role>` | Affected GUI flows, CLI commands, MCP tools, or API contracts and compatibility. | Implementing the affected interface. |
| Business and data model | `<Required, Not applicable: reason, or Assess during execution: trigger>` | `<Reviewer or role>` | Business concepts, rules, entities, relationships, schemas, and migration impact. | Implementing the affected model or data changes. |
| Architecture | `<Required, Not applicable: reason, or Assess during execution: trigger>` | `<Reviewer or role>` | Affected modules, responsibilities, boundaries, dependencies, and any split or combination. | Implementing the affected structural changes. |
| Delivery acceptance | Required | User or accountable owner | Integrated revision, validation evidence, and manual test results when required. | Marking the task completed and archiving it. |

## References

Use a file-relative link for anything stored in this task directory. For other
repository-local targets, use `/path/from/repository/root` when the project
profile declares root-link support; otherwise use a portable file-relative
link.

- External Issue or canonical repository document.