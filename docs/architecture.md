# Architecture

Agents inspect and modify repositories inside short-lived Render Sandboxes.
Code in the Workflows service validates their results and performs every
GitHub write.

## System

```mermaid
flowchart LR
  GitHub -->|signed webhook| Gateway
  Gateway -->|start task| Workflows
  Workflows -->|restore| Sandbox
  Sandbox -->|typed result or candidate tree| Workflows
  Workflows -->|validated write| GitHub
  Workflows -->|build| Snapshot
  Snapshot -.->|restore| Sandbox
```

The Blueprint deploys two services:

- **Gateway** verifies webhooks and maps each delivery to one task.
- **Workflows** runs tasks, manages Sandboxes, and writes to GitHub.

The application does not implement its own queue, dispatcher, heartbeat
process, maintenance loop, or database.

## Workflow

```text
issue --factory:triage--> specification
specification --factory:spec-approved--> draft pull request
pull request --factory:pr-review--> COMMENT review

push to the base branch --signals fire--> refactor proposal issue
refactor proposal --factory:refactor-approved--> draft refactor pull request
pull request --factory:refactor-review--> refactoring review comment
```

The first three lines are the inner loop: one change request at a time. The
last three are the outer loop, which keeps the code those changes land in
cheap to change. It separates when to refactor from what to refactor: plain
code decides when, from change history, and the refactoring skill decides
what, only when the code points somewhere.

### Triage

Triage reads the issue discussion and the base branch. The triage agent asks
up to five questions, declines the request, or sends it to the spec-writing
agent. The spec-writing agent produces a bounded specification. Questions and
specifications are GitHub comments with hidden markers.

### Spec-to-PR

Spec-to-PR confirms that the approved specification has not changed. It
implements that specification in a Sandbox, runs the configured verification
commands, allows a bounded number of repairs, and opens a draft pull request
on `factory/issue-<number>`.

### PR Reviewer

PR Reviewer checks out the labeled pull request commit, runs the configured
verification commands, and posts one COMMENT review. The review covers
security, correctness, performance, and tests.

### Autopilot

Applying `factory:autopilot` grants upfront approval for Triage, Spec-to-PR, and PR Reviewer.
The parent starts each GitHub task with `ctx.run`, so every stage has its own compute, claim,
status, and Sandbox.

Autopilot does not apply the manual transition labels. Triage can still remove
a stale `factory:spec-approved` label when it revises a spec. Triage returns
the exact App-authored spec comment and content hash to Spec-to-PR, which
verifies that the current spec still matches. Spec-to-PR returns the pull
request number and head commit directly to PR Reviewer. If Triage asks
questions, the parent adds `factory:autopilot` back before it ends; a human
reply starts a new parent run. At other times the trigger label is absent, so
unrelated comments do not restart the workflow.

### Refactor gate

Every push to the base branch of a repository with `refactor` configured
starts the refactor gate beside the snapshot refresh. The gate reads the last
five merges in a Sandbox and computes three signals with no model:

- **Heat:** files changed in 3 of the last 4 merges.
- **Health:** cognitive complexity above 15 per function and copies of 50 or
  more tokens, scored down from 10, with a bar at 9.5.
- **Coupling:** files in two or more directories that changed together in 3
  of the last 4 merges.

The gate opens on a hot file below the health bar that got less healthy over
the window, or on a coupled cluster. It fires only on the merge where that
problem first appears, so a problem that persists doesn't cost a review on
every merge. Hard code nobody is changing never opens it.

When it fires, the gate installs the refactoring skill, writes people's past
rejections into the skill's ledger, and has the refactor reviewer review the
window's merges as one change, starting from the files the signals named. The
reviewer may decline. Otherwise the gate opens one issue labeled
`factory:refactor-proposal` with the brief, the chosen finding, and the
review's spend. It opens at most one at a time.

### Refactor

Applying `factory:refactor-approved` to a proposal starts the refactor task.
In one Sandbox at the base branch head:

1. the replay author writes a deterministic replay of the code at the
   finding's sites;
2. the workflow runs it twice, keeps it only if both outputs match, and moves
   it into a root-only directory;
3. the refactor applier applies the finding behind characterization tests;
4. the workflow restores the replay, runs it again, and discards the refactor
   if any output line changed;
5. the configured verify commands run; and
6. Workflows publishes `factory/refactor-<issue>` and opens a draft pull
   request that closes the proposal when merged.

`factory:refactor-rejected` drops a proposal. The rejected issues are the
ledger: later reviews never propose those findings again.

### Refactor Review

`factory:refactor-review` on a pull request runs the refactor reviewer on the
pull request's diff and posts one comment for its head commit. It changes no
code.

## State

Each system owns the state it already manages:

| State | Owner |
|---|---|
| Task status, timing, input, and result | Render Workflows |
| Issues, labels, specifications, pull requests, and reviews | GitHub |
| Current run and Sandbox for an issue or pull request | App-authored status comment |
| Refactor proposals and rejected findings | App-authored issues and their labels |
| Agent spend on each factory change | Hidden marker on its pull request |
| Prepared repository filesystem | Render Sandbox snapshot |
| Run and agent outcomes, usage, and cost | JSON lines in Workflows logs |

The refactor gate keeps no state of its own. It recomputes the signals from
git history on every push, and its edge trigger compares two windows of that
same history.

Telemetry is not application state. Nothing reads log events to decide what a
task may do.

## Coordination

Webhook delivery is not exactly once. GitHub can redeliver events, and people
can apply labels or post comments at the same time. The factory handles this
at three boundaries:

1. The GitHub delivery ID becomes the Workflows idempotency key.
2. The status comment names the run that holds the claim on an issue or pull
   request.
3. Hidden markers identify App-authored specifications, pull requests, and
   reviews so writes can update or reuse them.

For a composed workflow, the status marker records both the root workflow run
and the current child task. Cancellation stops the root; the child ID still
identifies the current stage and Sandbox.

A new GitHub task run cancels the run named in the status comment, terminates
its recorded Sandbox, and writes its own run ID to the comment. The run whose
write remains visible holds the claim. Other runs stop when they next check
the comment.

GitHub tasks check ownership before progress updates and durable writes.
Publishing also uses a deterministic branch and refuses to overwrite human
commits.

This design keeps coordination beside the GitHub object it controls. Adding a
database would create a second owner for the same claim.

## Sandboxes and snapshots

A base-branch push builds a repository snapshot with the runner, a base
checkout, and installed dependencies. A GitHub task then:

1. restores the newest snapshot;
2. replaces the snapshot's runner bundle with this deployment's when their
   hashes differ, root-owned and read-only to the runner user;
3. verifies runtime permissions and process hardening;
4. fetches the exact requested ref with a temporary read-only token;
5. removes the token and verifies its removal;
6. reinstalls dependencies when the lockfiles or install command changed;
7. runs agents and repository commands as an unprivileged user; and
8. closes the Sandbox in `finally`.

Render terminates a cancelled task without running `finally`. For that case,
each GitHub task records its Sandbox ID in the status comment. A replacement
run or `/factory cancel` terminates the recorded Sandbox. The provider timeout
is the final cleanup backstop.

Snapshots avoid reinstalling dependencies on every run. Restored Sandboxes
still fetch the requested commit and verify their current state; a snapshot is
prepared state, not trusted current state.

## Agents

An agent definition fixes:

- its prompt;
- its harness: the agent library and model that run it;
- available tools;
- output schema;
- turn limit; and
- stable ID.

The model loop and every model-directed tool run in the Sandbox beside the
checkout. Agent tools never run on the Workflows host.

A harness adapter in `app/harness/` wraps an agent library's own
configuration. Agent definitions and their harnesses are bundled into the
Sandbox runner, which runs the agent named in its input on that agent's
harness. The host and the runner speak a versioned contract
(`app/runner/core/protocol.ts`): JSON on stdin, with the key on the first line,
and JSON Lines events on stdout. Every harness gives the model the factory's
own tools and `submit`, so tool authority and the read-only shell policy don't
depend on the library. In the runner, a kernel owns each run: its events, turn
and time limits, tools, and submission. A harness's driver only translates its
library.

Every agent finishes through a typed `submit` tool. The runner validates the
submission against JSON Schema. The host validates it again with the agent's
Zod schema. Repositories, refs, issue numbers, pull requests, branches, and
write targets come from authenticated task input, never model output.

## Publishing

The Sandbox has no GitHub write credential. It returns a candidate tree to
the Workflows host, which:

1. collects changes through a throwaway Git directory;
2. validates paths, modes, file counts, sizes, and blob hashes;
3. rejects workflow files, symlinks, and submodules;
4. asks GitHub to build the same tree;
5. compares GitHub's tree SHA with the Sandbox tree SHA; and
6. moves the deterministic branch only when the factory still owns it.

## Trust boundaries

Issue text, comments, source files, dependency scripts, and pull request diffs
are untrusted.

### Gateway

The gateway verifies the webhook signature before parsing the body. It holds
no GitHub credential and runs no model or repository code.

### Workflows host

The Workflows service holds GitHub and Render credentials. It selects every
destination, checks claim ownership, validates Sandbox output, and performs
GitHub writes.

### Sandbox

Clone and fetch credentials are read-only and temporary. Runtime files are
root-owned and read-only. Agents and repository commands run as an
unprivileged user.

The model key enters the Sandbox during an agent call. The runner receives it
through a root-only path and stdin, removes provider keys from tool
environments, and runs under a non-dumpable Node binary. These controls reduce
exposure; they do not make untrusted code safe.

## Security invariants

Changes must preserve these properties:

1. Verify a webhook signature before parsing its body.
2. Check the triggering actor's current repository permission for every
   GitHub task run.
3. Let only code in the Workflows service write to GitHub.
4. Keep GitHub write credentials out of Sandboxes.
5. Run every model-directed tool inside a Sandbox.
6. Build repositories, refs, branches, and write targets from trusted input.
7. Publish only after GitHub reproduces the validated tree SHA.
8. Stop automation at a draft pull request, a COMMENT review or comment, and a
   proposal issue. Only a person's label applies a refactor.
9. Implement the specification as it existed when approved.
10. Give every Sandbox a provider timeout and `finally` cleanup. Record a
    GitHub task's Sandbox so cancellation can terminate it.
11. Keep the replay away from the agent it grades: record it before the
    applier runs, hold it root-only while it runs, and publish a refactor only
    when the replay's output is unchanged and every verify command passes.
12. Trust proposal, review, and spend markers only on App-authored issues,
    comments, and pull requests.
13. Keep the refactoring skill and its working files out of published
    changes: the skill lives outside the checkout, and `.refactor/` is reset
    before publishing.

Tests pin these invariants and the tool authority of every built-in agent.

## Residual risks

- Sandboxes use allow-all egress.
- The model key exists in runner memory during a call.
- Prompt injection can influence specifications, code, and reviews.
- Anyone with `minimumPermission` can start model spend.
- PR Reviewer runs repository-defined commands from the labeled pull request.
- Anyone who can push to a base branch with the gate on can start one review's
  model spend, at most once per newly formed problem.
- The replay runs through the repository's own tooling, which the applier can
  edit; verification and the draft PR's human review back the replay up.
- The refactor reviewer has write tools because the skill writes working
  files; the workflow discards everything it changed.
- The Render API key may have workspace-wide authority.
- Near-simultaneous triggers can both work until one loses the status-comment
  claim.
- Workflows inputs and results are visible to people with service access.
- Telemetry can include repository names, issue subjects, and errors that
  quote repository output.
- The filesystem of each deployed Render service is ephemeral. Durable state
  belongs in GitHub, Workflows, or Sandbox snapshots.
- A cancelled snapshot build can leave its builder Sandbox running until the
  one-hour provider timeout because builders are not recorded in a status
  comment.

Use a dedicated Render workspace and a spend-capped model key when stronger
isolation matters.

Expected work failures produce a useful status-comment result. Unexpected
platform or programming failures fail the Workflows task and require
operator investigation.

## Code map

Start with:

1. [`app/gateway/routes.ts`](../app/gateway/routes.ts) — webhook-to-task
   routing.
2. [`app/workflows/github-task.ts`](../app/workflows/github-task.ts) —
   GitHub task declaration.
3. [`app/claims/claim.ts`](../app/claims/claim.ts) — permission, ownership,
   progress, and completion.
4. [`app/workflows/triage/index.ts`](../app/workflows/triage/index.ts) — one
   complete GitHub task.
5. [`app/workflows/autopilot/index.ts`](../app/workflows/autopilot/index.ts) —
   parent/subtask orchestration.
6. [`app/agents/run.ts`](../app/agents/run.ts) — host-side agent execution.
7. [`app/runner/main.ts`](../app/runner/main.ts) — Sandbox runner entry point;
   [`app/harness/`](../app/harness/) — agent library adapters.
8. [`app/sandbox/sandbox.ts`](../app/sandbox/sandbox.ts) — Sandbox lifecycle.
9. [`app/changeset/index.ts`](../app/changeset/index.ts) — validated
   publishing.
10. [`app/refactor/signals.ts`](../app/refactor/signals.ts) — when the gate
    fires; [`app/workflows/refactor-gate/index.ts`](../app/workflows/refactor-gate/index.ts)
    and [`app/workflows/refactor-apply/index.ts`](../app/workflows/refactor-apply/index.ts)
    — the outer loop; [`skills/refactoring/`](../skills/refactoring/) — what
    to change.

Use the [extension runbook](runbooks/extend.md) to add agents, tasks, or
triggers.
