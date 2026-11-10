# A self-improving codebase

Coding agents inherit the code left by previous runs. This repository runs two loops on Render: one turns issues into draft pull requests; the other keeps frequently changed code easier to change.

The refactoring loop separates **when** to refactor from **what** to refactor:

- **When:** After a merge, a gate checks file change frequency, code health, and coupling. Hard-to-change code that is rarely touched is generally left alone.
- **What:** When the gate fires, a refactoring skill reviews recent changes and proposes one refactor—or none.
- **Safety:** A person approves the proposal. A separate agent records existing behavior, and the refactoring agent cannot see that recording. The factory opens a draft PR only if replay and verification pass.

Every factory PR records agent spending. Run `npm run cost-report` to compare the cost of changes before and after a refactor.

Built on [software-factory](https://github.com/render-examples/software-factory), an extensible template for GitHub-native agent workflows on Render.

## Get started

Deploy from a fork; `factory.config.ts` defines which repositories the factory can access.

1. Check the prerequisites in the [Quickstart](docs/quickstart.md).
2. Ask a coding agent to follow the [Setup runbook](docs/runbooks/setup.md).
3. Complete the GitHub, secrets, and paid-resource checkpoints when prompted.

The runbook configures and deploys the factory, connects its webhook, verifies its services, and runs a Triage smoke test.

## Included workflows

### Inner loop

- **Triage:** Reads an issue and repository, then asks questions, writes a specification, or declines.
- **Spec-to-PR:** Implements an approved specification, runs verification, and opens a draft PR.
- **PR Reviewer:** Runs verification and posts a non-approving review covering security, correctness, performance, and tests.

### Outer loop

- **Refactor gate:** Checks signals after pushes to the base branch and opens a proposal when warranted. Enable it per repository with `refactor.sources`.
- **Refactor:** Apply `factory:refactor-approved` to execute an approved proposal behind the replay guard, or `factory:refactor-rejected` to discard it.
- **Refactor Review:** Apply `factory:refactor-review` to a PR to post the skill’s review as a comment.

GitHub holds the discussion and review; Render Workflows runs tasks; isolated Sandboxes run agents and tools. **The factory never approves or merges code.**

For upfront approval of the issue-to-review stages, apply `factory:autopilot`. If Triage needs clarification, the workflow pauses until a person replies.

## Extend

Add agents, harness adapters, Workflows tasks, or GitHub triggers. Configure repositories, commands, permissions, and limits in `factory.config.ts`, and models in `app/agents/models.ts`.

The factory provides event authentication, isolated execution, run coordination, typed outputs, and a publishing boundary. You provide the workflow logic, repository commands, permissions, models, budgets, and integrations.

See the [extension runbook](docs/runbooks/extend.md).

## Security and limits

- Model-directed code runs in Sandboxes; GitHub write credentials stay outside them.
- Publishing validates targets and rejects unsafe or oversized changes. GitHub must reproduce the candidate tree SHA before publication.
- Sandboxes allow all network egress, and the model key is in runner memory during a call. Review the [trust boundaries and residual risks](docs/architecture.md) before using private code or untrusted PRs.
- Verification runs shell commands; browser testing is not included.
- Timeouts and turn limits bound execution, but there is no hard dollar budget. Authorized users and enabled gates can start model spend.
- The gate’s health score supports JavaScript and TypeScript. The refactoring skill can review any language.
- Sandbox API calls count against the Render workspace’s request limit.

## Documentation

- [Quickstart](docs/quickstart.md)
- [Setup runbook](docs/runbooks/setup.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Extension runbook](docs/runbooks/extend.md)
- [Contributing](https://CONTRIBUTING.md)

## License

[MIT](LICENSE).