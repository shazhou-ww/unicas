# Deployment

## Steps

### D-S01: Validate the release candidate

Run the Admin WebUI focused tests, typecheck, build, and repository validation
for the exact candidate.

### D-S02: Promote through the protected release path

Deploy the validated Console bundle through the normal protected UniCAS release
workflow without bypassing exact-revision checks.

### D-S03: Verify Console behavior

Exercise first load, cached revisit, background replacement, refresh failure,
mutation invalidation, conflict handling, and logout cleanup with non-sensitive
test data.

## Acceptance criteria

### D-AC01: The deployed Console matches the candidate

The protected release identifies the exact validated revision and serves its
Admin WebUI bundle. Prove it with release evidence and the repository's normal
post-deployment checks.

### D-AC02: User-visible cache behavior is correct

The deployed Console demonstrates immediate safe cached rendering, background
revalidation, precise invalidation, accessible errors, and session cleanup.
Prove it with the documented manual scenario and focused automated evidence.
