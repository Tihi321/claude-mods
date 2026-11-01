---
name: test-discipline
description: Keep test suites small. Use any time tests are written, added or changed, in any repo - add only the few most important tests, reuse existing ones, never test for coverage.
---

# Test discipline

Few tests, each one earning its place. A big suite is slow, brittle and hides what matters.

## Budget
- One test per acceptance criterion or behaviour that a user or caller relies on.
- One regression test per bug fixed: it fails before the fix and passes after.
- Nothing else by default.

## Prefer
- Test through public interfaces.
- One table-driven test over many near-identical cases. Keep the table short: the boundaries plus one typical case.
- One end-to-end happy path per feature, not many e2e variants.

## Do not
- Test framework or library behaviour.
- Test private helpers, getters, constants, snapshots of trivial data, or every enum value.
- Test the same rule at three layers. Pick the lowest layer that proves it.
- Add tests "for coverage".
- Add a slow e2e or browser test when a unit test proves the same thing.
- Use sleeps or long timeouts.

## Before adding
- Search for an existing test that already covers it. Extend that one instead.
- If the area is over-tested, you may delete redundant tests in the same change. Say so in the report.

## Keep the fast suite fast
- Mark slow and e2e tests separately, using the repo's convention (tag, folder, or separate script).

## Report
- List the tests added and removed, and the criterion or bug each one covers.
