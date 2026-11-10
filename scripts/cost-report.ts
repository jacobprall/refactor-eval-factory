/**
 * Prints what the factory's merged changes cost and how changes to refactored code compare before and after each
 * refactor. Read-only. Prices come from the spend markers the factory writes on its PRs.
 *
 *   npm run cost-report [-- --repo owner/name]
 */
import { parseArgs } from "node:util";
import { config } from "../app/config/index.js";
import { loadPricedChanges, refactorPayback, renderReport } from "./lib/cost-report.js";
import { GitHubApp, splitRepo } from "./lib/github.js";
import { errorMessage } from "./lib/output.js";

const { values } = parseArgs({ options: { repo: { type: "string" } } });
const repos = values.repo ? [values.repo] : Object.keys(config.repos);

try {
	const app = new GitHubApp({ env: process.env, fetch: globalThis.fetch, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
	const bot = `${(await app.getApp()).slug}[bot]`;
	for (const fullName of repos) {
		const { owner, name } = splitRepo(fullName);
		const installation = await app.repoInstallation(owner, name);
		if (!installation) {
			console.error(`The App isn't installed on ${fullName}; skipped.`);
			continue;
		}
		const token = await app.installationToken(installation.id, name, { pull_requests: "read", metadata: "read" });
		const changes = await loadPricedChanges(app.repo(owner, name, token), bot);
		console.log(`${renderReport(fullName, changes, refactorPayback(changes))}\n`);
	}
} catch (error) {
	console.error(`cost-report failed: ${errorMessage(error)}`);
	process.exitCode = 1;
}
