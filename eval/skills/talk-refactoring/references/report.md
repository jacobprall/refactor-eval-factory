# Report

Write `.refactor/report.md` with this template, and `findings.json` with the format in [formats.md](formats.md). The report is for a reader deciding what to fix. Lead with the answer, quote the code, and keep each finding self-contained.

```markdown
# Refactoring report: <repo or PR title>

<One paragraph: overall health in plain words, the two or three things most worth doing,
and whether the run was static only or used probes.>

## At a glance

- Scope: <repo | diff vs base>, <source lines>, <modules> modules, size class <S/M/L/XL>
- Pace: <commits/week>, <files added in 30 days>, <agent-attributed share> (trailer-based; a lower bound)
- Tests: <test files per source file>, <mocks per test file>, probes <ran | not run>
- Findings: <n> (<high>/<medium>/<low>), questions <n>, signals checked and dismissed <n>
- Where it clusters: <the two or three modules with the most findings>

## Top findings

### F1. <Title that names the problem and the place>

**<Primary smell>** <+ secondary tags> · severity <level> · confidence <level> · effort <S/M/L> · when <value> · risk <level>

<Sites: path#symbol, one per line; for many sites, the count and the first three.>

<Quoted excerpt, at most 15 lines, in a fenced code block with the file path.>

**Why it matters.** <The symptom, in this codebase's terms.>

**Case for.** <What fixing it buys.>

**Case against.** <The honest reason to leave it: cost, risk, or that it's deliberate.>

**Plan.**
1. <Refactor card> (<direction>, <behavior label>): <one line, specific to this code>
2. ...

<Repeat for up to ten findings.>

## More findings by smell

### <Smell>
- <Title> · <severity> · <effort> · <when> · <path#symbol>

## Questions

- <Low-confidence item>: <what you'd need to know to decide>.

## Checked and dismissed

- <card> at <site>: <why it's not a finding>. (Show the strongest dismissed signals, up to ten.)

## Run

- Signal hits in scope: <n>, candidates: <n>, findings: <n>, questions: <n>, dismissed: <n> (one per site)
- Cards loaded per work unit, cross-module families run, probes run
- Suppressed by the ledger: <n>
```

## Rules

- **Top findings** holds the first ten by rank. With ten or fewer findings, all of them go there and "More findings by smell" is omitted.
- **Titles name the problem and the place.** "Three currency formatters that round differently" rather than "Reinvented Logic found".
- **The case against is required.** If you can't think of one, check the card's "Not a finding" list again. When the honest answer is "none", say why.
- **Quote, don't paraphrase,** the code that makes the finding true.
- **Behavior changes are labeled** in the plan line, and the finding's risk reflects them.
- **In chat,** give the summary paragraph and the top three findings by title, then point to the report file.
- **Diff scope:** findings in code the change introduced come first; pre-existing issues in touched code follow under "Already here before this change".
