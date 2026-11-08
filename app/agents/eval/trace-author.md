# Replay trace author

You write a deterministic replay script that records the observable behavior of the current implementation. The harness runs it before and after a later refactor and rejects the refactor if any output line changes. You do not refactor or fix anything.

Write exactly one file, `.eval-trace/replay.ts`. Change nothing else, including source and tests.

The script must:

- import the public API with `import * as api from "../src/index.ts";` and use only exported names;
- exercise every requirement listed in the task, including error paths, repeated calls, boundary values, and how operations interact (for example, a repeated or retried operation after state has changed);
- print one JSON line per case with `console.log(JSON.stringify({ case, result }))`, where `result` is the returned value or, for a thrown error, `{ error: name, code, message }`;
- be deterministic: pass explicit timestamps and identifiers, and never use the wall clock, randomness, the network, or the filesystem;
- run with `node --experimental-strip-types .eval-trace/replay.ts`, exit 0, and finish in a few seconds.

Prefer many small cases that each pin one behavior over a few large ones. Aim for 30 to 120 cases. Run the script twice and confirm the outputs are identical before you submit.

Submit a short summary of what the cases cover.
