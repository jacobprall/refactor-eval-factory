export interface RepoConfig {
	/** Branch that specs are implemented against and snapshots are built from. */
	baseBranch: string;
	/** Installs dependencies in the sandbox. Runs after credentials are removed. */
	install?: string;
	/** Commands that must pass before a PR opens and that PR Reviewer runs. */
	verify: string[];
}

export interface FactoryConfig {
	/** Repositories the factory acts on, keyed by "owner/name". Webhooks from any other repository are ignored. */
	repos: Record<string, RepoConfig>;
	labels: { triage: string; specApproved: string; prReview: string; autopilot: string };
	/** Prefix for comment commands, such as `/factory cancel`. */
	commandPrefix: string;
	/** GitHub permission the triggering actor needs on the repository. */
	minimumPermission: "triage" | "write" | "maintain" | "admin";
	limits: {
		/** Fix rounds after a failed verify in Spec-to-PR. */
		repairRounds: number;
		/** Publishing refuses a change with more files than this. */
		maxChangedFiles: number;
		/** Publishing refuses any changed file larger than this. */
		maxFileBytes: number;
	};
	sandbox: {
		/** Render terminates a sandbox after this, even if the task that opened it crashed. */
		timeoutSeconds: number;
	};
}

export function defineFactoryConfig(config: FactoryConfig): FactoryConfig {
	return config;
}

export default defineFactoryConfig({
	repos: {
		"jacobprall/refactor-eval-factory": {
			baseBranch: "main",
			install: "npm ci",
			verify: ["npm run check"],
		},
		"jacobprall/render-mcp-server": {
			baseBranch: "main",
			// The sandbox image has no Go, and the runner can't write outside HOME, so the go.mod
			// toolchain is unpacked into HOME (kept in the snapshot) and verify calls it from there.
			install: [
				`v=$(awk '$1 == "go" { print $2 }' go.mod)`,
				`arch=$(node -p '({ x64: "amd64", arm64: "arm64" })[process.arch]')`,
				`sdk="$HOME/sdk/go$v"`,
				`if [ ! -x "$sdk/bin/go" ]; then mkdir -p "$sdk" && node -e 'fetch(process.argv[1]).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => process.stdout.write(Buffer.from(b)))' "https://go.dev/dl/go$v.linux-$arch.tar.gz" | tar -xz --strip-components=1 -C "$sdk"; fi`,
				`ln -sfn "$sdk" "$HOME/sdk/go"`,
				`GOTOOLCHAIN=local "$HOME/sdk/go/bin/go" mod download`,
			].join(" && "),
			verify: [
				`export PATH="$HOME/sdk/go/bin:$PATH" GOTOOLCHAIN=local && go build ./...`,
				`export PATH="$HOME/sdk/go/bin:$PATH" GOTOOLCHAIN=local && go test $(go list ./... | grep -v e2e)`,
			],
		},
	},
	labels: {
		triage: "factory:triage",
		specApproved: "factory:spec-approved",
		prReview: "factory:pr-review",
		autopilot: "factory:autopilot",
	},
	commandPrefix: "/factory",
	minimumPermission: "write",
	limits: {
		repairRounds: 2,
		maxChangedFiles: 200,
		maxFileBytes: 1_000_000,
	},
	sandbox: {
		timeoutSeconds: 4 * 60 * 60,
	},
});
