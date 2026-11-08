# File formats

Everything lives in `.refactor/` at the repository root. `recon.py` writes a `.gitignore` there that ignores everything except `map.md` (commit it if you want the model pass cached) and `ledger.jsonl` (commit it so decisions persist).

| File | Written by | Read by |
|---|---|---|
| `profile.json` | `recon.py profile` | every later step |
| `map.json`, `map.md` | `recon.py map`, then the model pass fills `map.md` | steps 5 and 6 |
| `candidates/map-pass.jsonl` | step 3 (leads) | step 6 |
| `probes.json` | step 4 | steps 5 and 6 |
| `candidates/<unit-or-family>.jsonl` | steps 5 and 6 | step 7 |
| `findings.json` | steps 7 and 8 | step 9, evals |
| `report.md` | step 9 | the user |
| `ledger.jsonl` | applying, or the user's accept/reject | step 7 of later runs |

The examples below use an invented codebase.

## Fingerprint

A finding's identity across runs: `<card>:<path>#<symbol>`, for example `swallowed-errors:src/orders/pricing.ts#quoteTotal`.

- The site is where the smell lives: the code the plan changes first. Not the caller that suffers from it, and not the copy that stays.
- The symbol is the enclosing function, class or exported name. Use the file path alone for file-level findings and the module id for module-level ones.
- Never use line numbers: they change with every edit.
- For several equivalent sites (five copies of a helper), use the first by path.

## Lead (step 3, `candidates/map-pass.jsonl`)

```json
{"lead": "reinvented-logic.similar-responsibility", "modules": ["src/orders", "src/invoices"], "note": "both 'compute line totals with tax and discounts'"}
{"lead": "inconsistent-solutions.synonym-terms", "modules": ["src/accounts", "src/billing"], "note": "'customer' and 'account' for the same record"}
```

Leads are not findings. The duplication family confirms or drops them.

## Candidate (one JSON object per line)

```json
{
  "card": "swallowed-errors",
  "fingerprint": "swallowed-errors:src/orders/pricing.ts#quoteTotal",
  "sites": [{"path": "src/orders/pricing.ts", "symbol": "quoteTotal", "lines": [41, 47]}],
  "excerpt": "try {\n  rate = await taxRates.lookup(region);\n} catch {\n  rate = 0;\n}",
  "signals": ["swallowed-errors.catch-default"],
  "reasoning": "A failed tax lookup silently quotes zero tax; checkout charges the wrong total. pricing.ts is internal, not a boundary.",
  "not_a_finding_checked": ["documented degradation: no, nothing logs or reports the fallback"],
  "also_check": ["toothless-tests"],
  "refactors": ["characterization-test", "narrow-error-handling"]
}
```

`excerpt` is required: at most about 15 lines, copied from the file. `not_a_finding_checked` lists the card's false-positive cases you ruled out; it is what makes a candidate trustworthy.

## Question (same files)

A candidate you couldn't decide because it needs knowledge you don't have. Same fields as a candidate, plus:

```json
{"question": true, "card": "dead-code", "fingerprint": "dead-code:src/legacy/export.ts", "excerpt": "...", "reasoning": "No importers, but the name matches a cron job in another repo.", "ask": "Is export.ts run by anything outside this repository?"}
```

## Dismissed signal (same files)

When you checked a strong signal and decided it isn't a finding, record it. The report's "Checked and dismissed" section and the evals use these. One record per site.

```json
{"dismissed": true, "card": "swallowed-errors", "signal": "swallowed-errors.empty-catch", "site": "src/jobs/cleanup.ts:88", "reason": "best-effort removal of a temp dir; documented degradation"}
```

## Finding (`findings.json`)

```json
{
  "version": 1,
  "scope": "repo",
  "head": "a1b2c3d",
  "static_only": true,
  "findings": [
    {
      "id": "F1",
      "fingerprint": "reinvented-logic:src/invoices/money.ts#formatCurrency",
      "title": "Three currency formatters that round differently",
      "primary": "reinvented-logic",
      "secondary": ["scattered-knowledge"],
      "sites": [
        {"path": "src/invoices/money.ts", "symbol": "formatCurrency", "lines": [12, 19]},
        {"path": "src/orders/display.ts", "symbol": "toPrice", "lines": [5, 9]},
        {"path": "src/emails/receipt.ts", "symbol": "money", "lines": [30, 33]}
      ],
      "excerpt": "export const toPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;",
      "symptom": "change amplification",
      "case_for": "Receipts and invoices disagree by a cent on some totals; one formatter fixes that and stops a fourth copy.",
      "case_against": "Each copy is small; merging needs a decision on which rounding is right.",
      "severity": "medium",
      "spread": {"sites": 3, "modules": 3, "growing": false},
      "confidence": "high",
      "effort": "S",
      "when": "next-change",
      "risk": "medium",
      "plan": [
        {"refactor": "characterization-test", "direction": "safety", "behavior": "preserving", "note": "pin the output of all three for amounts ending in .005"},
        {"refactor": "replace-with-existing-function", "direction": "remove", "behavior": "changes-behavior", "note": "keep formatCurrency; toPrice's rounding changes for half-cent amounts"}
      ]
    }
  ],
  "questions": [{"fingerprint": "dead-code:src/legacy/export.ts", "card": "dead-code", "ask": "Is export.ts run by anything outside this repository?"}],
  "dismissed": [{"card": "swallowed-errors", "site": "src/jobs/cleanup.ts:88", "reason": "best-effort temp dir cleanup"}],
  "stats": {"signal_hits": 0, "candidates": 0, "findings": 0, "questions": 0, "dismissed": 0}
}
```

`stats.signal_hits` is the sum of signal counts in scope from `profile.json` and `map.json`; `dismissed` counts records, one per site.

A plan step's `behavior` starts from its card's label but describes this application: if replacing a copy changes rounding, adds retries or changes output, the step is `changes-behavior` and its note says what changes.

## Ledger (`ledger.jsonl`, append only)

```json
{"fingerprint": "reinvented-logic:src/invoices/money.ts#formatCurrency", "decision": "accepted", "status": "done", "at": "2026-10-25", "by": "user", "reason": "", "commit": "abc1234"}
{"fingerprint": "shallow-modules:src/config", "decision": "rejected", "at": "2026-10-25", "by": "user", "reason": "config values are grouped on purpose"}
```

`decision` is `accepted`, `rejected` or `deferred`. A rejected fingerprint is suppressed in later runs until the code at that site changes substantially (its excerpt no longer matches). The ledger is also the record of how many findings were accepted versus rejected as noise.

## Probes (`probes.json`)

```json
{
  "ran": ["npm test", "npx tsc --noEmit --noUnusedLocals --noUnusedParameters"],
  "tests": {"command": "npm test", "passed": true, "duration_s": 41},
  "signals": {
    "dead-code.unused-warning": [{"path": "src/orders/display.ts", "line": 12, "message": "'LEGACY_ROUNDING' is declared but never used"}],
    "toothless-tests.survives-stub": [{"test": "tests/pricing.test.ts", "function": "src/orders/pricing.ts#quoteTotal"}]
  }
}
```
