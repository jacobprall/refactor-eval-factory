# Scoring

Score every finding on six fields, then rank. The fields exist so the user can make the right call quickly; each one needs a reason you could state in a sentence.

## Severity: what it costs if left alone

| Level | Meaning |
|---|---|
| high | Hides failures or false confidence (swallowed errors on a real path, tests that can't fail), or slows every change in a hotspot |
| medium | A real, recurring cost: change amplification across modules, a structure people and agents keep working around |
| low | Reading cost only, or a cost that stays local |

Raise one level (to at most high) when any of these hold, but only when each site carries a real cost. Five copies of a one-line helper stay low; record the spread, and let it show in the report.

- **Spread:** the pattern appears at five or more sites, or in three or more modules.
- **Growth:** sites were added in the last 30 days (git blame on the sites). Agents copy what is present, so a growing pattern compounds.
- **Hotspot:** the site is among the first ten entries of `evidence["overloaded-module.hotspot"]` in `profile.json` (ranked by recent commits times size).

Lower one level when the code hasn't changed in the profile window and no change is pending there.

Cards with `severity_cap` in their frontmatter (Bloated Test Setup, Narrating Comments) never go above that level. No card gets a bonus for being "typical of agent code"; the evidence for that varies by card and is stated on the card.

## Spread

`{"sites": n, "modules": m, "growing": true|false}`. Count confirmed sites, not signal hits.

## Confidence: how sure you are that it is a problem

| Level | Meaning |
|---|---|
| high | Confirmed by reading, and backed by a probe, a test, git history, or a mechanical fact (a cycle, an unused export) |
| medium | Confirmed by reading; you ruled out the card's "Not a finding" cases |
| low | Plausible, but deciding needs knowledge you don't have (intent, roadmap, external callers) |

Low-confidence items go in the report's **Questions** section, not in the findings.

## Effort: what the fix takes

| Size | Typical scope | Rough agent cost |
|---|---|---|
| S | One function or file; no signature changes outside it | under 50K tokens |
| M | One module, or a signature change with a handful of callers | 50K to 250K tokens |
| L | Several modules, many call sites, or a migration | over 250K tokens; split it |

Add one size when the code has no tests and the plan needs a characterization test first. The token ranges are for ordering work, not quotes.

A card's `requires` field applies when the code at the site lacks tests that would catch the change. Skip it, and say why in the plan note, when the change is mechanical and the type checker verifies it (replacing identical one-line copies, deleting a symbol with no references).

## When: Beck's first, after, later, never

| Value | Rule |
|---|---|
| now | It causes bugs or hides failures, or it blocks a change the user is making (in diff scope, the change itself) |
| next-change | Fix it the next time someone works in this code: the site is in a hotspot or churned in the window |
| later | Real cost, but the code is stable; schedule it |
| never | The code doesn't change and the cost is reading only. Report as information, not as a recommendation |

In diff scope, findings in code the change didn't touch are at most `later`.

## Risk

| Level | Meaning |
|---|---|
| low | Behavior-preserving, local, and covered by tests or the type checker |
| medium | Behavior-preserving but crosses modules; or changes failure paths or internal behavior that tests cover |
| high | Touches a public API, a persisted format, a schema or an external contract, or changes behavior users or other systems can see. Say so explicitly; it needs the user's decision |

Start from the plan's cards (their `risk` and `behavior` fields), then adjust for how the plan applies them here. A card labeled `preserving` becomes a behavior change when this application changes output, timing or retries; label the step and say what changes.

## Direction check

Every plan step has a direction from its card: remove, reshape, add, test or safety.

- An **add** step needs a driver you can name: a pending change, knowledge repeated across sites, a second implementation (a test fake counts), or a hotspot where unrelated changes keep colliding (git shows the file in commits for different features). Without one, drop the step or set `when` to `later`.
- When an add and a remove would both fix the finding, prefer the remove.
- For any add step bigger than one module, compare two candidate designs on interface size before recommending one (design it twice).

## Ranking

Sort by `when` (now, next-change, later, never), then severity, then confidence, then effort (smaller first). Put at most ten findings in the top section of the report. Group the rest by card.
