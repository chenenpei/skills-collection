---
name: code-simplify
description: Reviews recent code changes for reuse, code quality, and efficiency issues, then fixes them directly. Use when the user asks to simplify or clean up a diff, refactor recent edits, review hacky code, or improve code quality after changes, including "code simplify", "simplify recent changes", "简化这次改动", or "检查复用问题". Defaults to review plus fix unless the user asks for findings only.
---

# Code Simplify

Use this skill to make recent code changes smaller, cleaner, and more reusable without changing the intended behavior.

## Expected Outcome

- Review the relevant changes or files.
- Identify concrete simplifications in reuse, code quality, and efficiency.
- Apply worthwhile fixes directly unless the user explicitly asks for review-only.
- End with a brief summary of what was fixed, or state that the code was already clean.

## Step 1: Determine The Review Scope

Inspect the smallest useful scope first:

1. If the user provided explicit files, a diff, or a focused area, use that as the primary scope.
2. Otherwise, if there are staged changes, inspect `git diff HEAD`.
3. Otherwise, inspect `git diff`.
4. If there are no git changes, review the most recently modified files that:
  - the user mentioned, or
  - you edited earlier in the conversation.

If the user gives an additional focus such as reuse, readability, or performance, prioritize it without skipping the other review passes.

## Step 2: Run Three Review Passes

Every pass should work from the same scope and context.

- If the environment supports subagents or parallel review workers, run the three passes in parallel.
- If parallel workers are unavailable, run the same passes serially.

### Pass 1: Reuse Review

Look for places where new code should reuse existing code instead.

Check for:

1. Existing utilities or helpers that already solve the problem.
2. New functions that duplicate behavior already present elsewhere.
3. Inline logic that should call an existing helper instead.
4. Hand-rolled string manipulation, path handling, environment checks, or ad-hoc type guards that should be replaced with existing utilities.
5. Nearby modules, shared directories, and adjacent files that already contain the right abstraction.

### Pass 2: Code Quality Review

Look for code that works but is unnecessarily awkward, leaky, or overcomplicated.

Check for:

1. Redundant state or cached values that could be derived.
2. Parameter sprawl caused by threading new flags through old APIs instead of reshaping the abstraction.
3. Copy-paste blocks with minor variation that should become a shared helper.
4. Leaky abstractions that expose internals or break established boundaries.
5. Stringly-typed logic that should use existing constants, enums, or unions.
6. Unnecessary JSX or wrapper structure that adds no layout value.
7. Comments that explain obvious code instead of preserving non-obvious constraints or rationale.

### Pass 3: Efficiency Review

Look for code that does unnecessary work or scales poorly.

Check for:

1. Redundant computation, duplicate reads, repeated API calls, or N+1 patterns.
2. Independent work that can run concurrently.
3. New work added to startup, request, render, or other hot paths without a clear need.
4. Recurring no-op updates in stores, reducers, polling loops, intervals, or event handlers.
5. Pre-checks for existence that should be replaced with direct operation plus error handling.
6. Missing cleanup, listener leaks, or unbounded in-memory data.
7. Broad reads or loads when only a small subset is needed.

## Step 3: Fix What Is Worth Fixing

Aggregate the findings from all three passes and apply the worthwhile fixes directly.

While fixing:

1. Preserve behavior unless the user explicitly asked for a behavior change.
2. Prefer existing abstractions over inventing new ones.
3. Keep changes targeted; do not launch unrelated refactors.
4. If a finding is a false positive or not worth addressing, skip it briefly and move on.
5. If the user explicitly asked for review-only, do not edit files. Report the findings in priority order with concise suggested fixes.

## Step 4: Verify The Result

After editing, run the narrowest relevant verification for the touched area:

- targeted tests
- type checks
- lint or formatting checks that do not rewrite unrelated files
- any repo-specific validation that proves the simplified code still works

If no automated verification exists, reread the final diff carefully and confirm the changes match the intended simplification.

## Response Style

Keep the final response brief and concrete:

- summarize what was simplified, or say the code was already clean
- mention any skipped findings only if they matter
- mention the verification you ran, or state clearly if no automated verification was available