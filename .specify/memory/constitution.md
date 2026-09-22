# Local Elections 2026 Constitution

## Core Principles

### I. Simplicity and Non-Duplication (KISS + DRY)

Solutions MUST be the simplest thing that satisfies the stated requirement.

- KISS: Prefer straightforward, readable code over clever or generalized code. Abstractions,
  configuration layers, and indirection MUST NOT be introduced until at least two concrete
  use cases require them. Speculative features (YAGNI) MUST be rejected during review.
- DRY: Any piece of knowledge - business rule, constant, data shape, or algorithm - MUST have
  a single authoritative representation. Copy-pasted logic MUST be extracted once a second
  occurrence appears.
- When KISS and DRY conflict, the reviewer decides and records the reason in the review; a
  small amount of duplication is acceptable if removing it would force a harder-to-follow
  abstraction.

Rationale: This project is maintained by a small team over a long calendar horizon. Code that
is easy to read and has one place to change is cheaper to correct under time pressure than
code that is maximally factored.

### II. Test-Driven Development (NON-NEGOTIABLE)

All production code MUST be produced through the Red-Green-Refactor cycle.

- A failing test MUST exist and be observed failing before the corresponding implementation
  code is written.
- Implementation MUST do no more than is needed to make the failing test pass.
- Refactoring MUST occur only while the test suite is green.
- Bug fixes MUST begin with a test that reproduces the defect and fails.
- Commits or tasks that add production code without accompanying tests MUST be rejected.

Rationale: Tests written first define the contract before the implementation can bias it, and
they give the refactoring demanded by Principle I a safety net.

### III. Mandatory Code Review

Every development task that writes code MUST be followed by a code review.

- Review is a required, explicit step in the task lifecycle - not an optional follow-up.
- The review MUST verify compliance with Principles I and II, correctness, and test coverage
  of the changed behaviour.
- If the review finds issues, they MUST be fixed before the task is considered complete.
  Fixes MUST themselves be re-reviewed when they change behaviour.
- A task is complete only when its review has no unresolved findings.

Rationale: Review is the enforcement point for the other two principles; without it, they are
aspirations rather than rules.

## Quality Standards

- The test suite MUST pass in full before any task is marked complete.
- Tests MUST be deterministic and independent of execution order.
- Test names MUST state the behaviour under test, not the implementation detail.
- Dead code, commented-out code, and unused dependencies MUST be removed rather than left in
  place.
- Any deviation from a principle MUST be documented in the pull request or task record with
  its justification; undocumented deviations are defects.

## Development Workflow

Each development task follows this sequence, in order:

1. **Specify** - the required behaviour is stated before any code is written.
2. **Red** - write a test that expresses that behaviour and observe it fail.
3. **Green** - write the minimum implementation that makes the test pass.
4. **Refactor** - remove duplication and complexity while the suite stays green.
5. **Review** - perform the code review required by Principle III.
6. **Fix** - resolve every finding from the review, then re-run the suite.

Steps MUST NOT be skipped or reordered. A task that reaches step 6 with unresolved findings
returns to step 4 or 5 as appropriate.

## Governance

This constitution supersedes all other development practices for this project. Where a tool
default, habit, or external convention conflicts with it, this document wins.

- **Amendments**: Changes MUST be proposed as an edit to this file, with the rationale stated
  and the version bumped in the same change.
- **Versioning**: Semantic versioning applies. MAJOR for removing or redefining a principle in
  a backward-incompatible way, MINOR for adding a principle or materially expanding guidance,
  PATCH for clarifications and wording that do not change meaning.
- **Compliance review**: Every code review under Principle III MUST check the change against
  these principles. Complexity that appears to violate Principle I MUST be justified in the
  review record or removed.

**Version**: 1.0.0 | **Ratified**: 2026-09-22 | **Last Amended**: 2026-09-22
