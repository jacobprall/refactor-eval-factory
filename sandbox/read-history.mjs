// Reads what the refactor gate needs from the checkout's base-branch history and writes it as one JSON file.
// Usage: node read-history.mjs <out_file> <window> <source_dir>...
//
// Runs as the runner user from the repository checkout. A "merge" is one first-parent commit on the checked-out
// branch: a merge commit, a squash, or a direct push. The gate compares two windows of <window> merges, the one
// ending at HEAD and the one ending at HEAD's first parent, so the output holds the production paths each of the
// last <window> + 1 merges changed (oldest first) and the production sources at the end and start of both windows.
// Production means a JavaScript or TypeScript file under a source dir that isn't a test or a declaration file.
// With fewer than <window> + 2 first-parent commits it writes {"insufficient": <count>}.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 10_000_000;
const SOURCE = /\.[cm]?[jt]sx?$/;
const NOT_PRODUCTION = /(?:^|\/)(?:tests?|__tests__|__mocks__|spec|fixtures)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

const [out, windowArg, ...dirs] = process.argv.slice(2);
const window = Number(windowArg);
if (!out || !Number.isInteger(window) || window < 1 || dirs.length === 0) {
	console.error("usage: read-history.mjs <out_file> <window> <source_dir>...");
	process.exit(2);
}

const git = (args, input) => execFileSync("git", args, { encoding: input === undefined ? "utf8" : "buffer", input, maxBuffer: 1 << 30 });
const isProduction = (path) => SOURCE.test(path) && !NOT_PRODUCTION.test(path);

const commits = git(["rev-list", "--first-parent", `--max-count=${window + 2}`, "HEAD"]).split("\n").filter(Boolean);
if (commits.length < window + 2) {
	writeFileSync(out, JSON.stringify({ insufficient: commits.length }));
	process.exit(0);
}

const changed = (commit) =>
	git(["diff", "--name-only", "--no-renames", "-z", `${commit}^1`, commit, "--", ...dirs])
		.split("\0")
		.filter((path) => path && isProduction(path));

function sourcesAt(rev) {
	const paths = git(["ls-tree", "-r", "-z", "--name-only", rev, "--", ...dirs])
		.split("\0")
		.filter((path) => path && isProduction(path));
	if (paths.length === 0) return {};
	const batch = git(["cat-file", "--batch"], Buffer.from(paths.map((path) => `${rev}:${path}\n`).join("")));
	const sources = {};
	let total = 0;
	let pos = 0;
	for (const path of paths) {
		const end = batch.indexOf(0x0a, pos);
		const [, type, size] = batch.subarray(pos, end).toString("utf8").split(" ");
		const length = Number(size);
		const start = end + 1;
		pos = start + length + 1;
		if (type !== "blob" || length > MAX_FILE_BYTES || total + length > MAX_TOTAL_BYTES) continue;
		total += length;
		sources[path] = batch.subarray(start, start + length).toString("utf8");
	}
	return sources;
}

writeFileSync(
	out,
	JSON.stringify({
		head: commits[0],
		windowBase: commits[window],
		merges: commits.slice(0, window + 1).reverse().map(changed),
		snapshots: {
			head: sourcesAt(commits[0]),
			previous: sourcesAt(commits[1]),
			windowBase: sourcesAt(commits[window]),
			previousWindowBase: sourcesAt(commits[window + 1]),
		},
	}),
);
