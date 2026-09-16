# Progress

Updated: YYYY-MM-DD

## Checklist

- [ ] Publish the claim to the shared primary branch.
- [ ] Obtain scope approval before substantive implementation.
- [ ] Complete each applicable interface, business and data model, and
	architecture approval before the affected implementation.
- [ ] Commit and publish substantive work at meaningful checkpoints.
- [ ] Publish implementation completion while the task is still ongoing.
- [ ] Complete documented manual user acceptance, if required.
- [ ] Obtain and publish delivery approval.
- [ ] Archive and publish the task as its final action.

## Current state

The latest verified state and the next concrete action.

## Decisions

- Decision and rationale.

## Human approvals

Copy all five checkpoints from `Task.md`. Use `Pending`, `Approved`,
`Not applicable`, or `Reopened`. An approval entry names the human reviewer,
date, reviewed artifact, and decision evidence. A not-applicable entry repeats
the task-specific rationale. Task creation, invocation, silence, and routine
Git authorization are not approval.

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Pending | Planned artifact and next review action. |
| Interface | `<Pending or Not applicable>` | Match the applicability and plan in `Task.md`. |
| Business and data model | `<Pending or Not applicable>` | Match the applicability and plan in `Task.md`. |
| Architecture | `<Pending or Not applicable>` | Match the applicability and plan in `Task.md`. |
| Delivery acceptance | Pending | Integrated revision and acceptance evidence after implementation publication. |

## Publication milestones

Replace pending entries with the shared primary branch and an immutable commit,
merge, or pull-request reference after publication. For the archive row, name
the target remote branch and archive commit in the final task update; the
resulting remote Git history supplies its immutable commit ID.

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | Pending. | Pending |
| Implementation complete | Pending. | Pending |
| Archive | Pending. | Pending |

## Validation

Link evidence stored in this task directory using a file-relative path. Link
other repository-local evidence using the project's declared root-relative or
portable file-relative convention.

- Command or behavior checked, with its result.

## Blockers

- None.

## Outcome

Fill this in before archiving as `Completed` or `Abandoned`, with a concise
reason and any remaining follow-up.