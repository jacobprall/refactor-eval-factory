import { Render } from "@renderinc/sdk";
import { TASKS } from "../app/config/index.js";
import { RunExperimentInput } from "../app/schemas/index.js";
import { NAMED_MANIFESTS } from "../eval/manifest.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
	const key = process.argv[i];
	const value = process.argv[i + 1];
	if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --name value pairs");
	args.set(key.slice(2), value);
}

const useLocalDev = process.env.RENDER_USE_LOCAL_DEV === "true";
const workflowSlug = process.env.RENDER_WORKFLOW_SLUG?.trim();
if (!useLocalDev && !workflowSlug) throw new Error("RENDER_WORKFLOW_SLUG is required outside local development");

const manifestName = args.get("manifest");
if (manifestName !== undefined && !(manifestName in NAMED_MANIFESTS)) {
	throw new Error(`unknown manifest ${JSON.stringify(manifestName)}; expected one of ${Object.keys(NAMED_MANIFESTS).join(", ")}`);
}
const named = manifestName ? NAMED_MANIFESTS[manifestName as keyof typeof NAMED_MANIFESTS] : undefined;

const input = RunExperimentInput.parse({
	...(named
		? { targetIds: named.targetIds, scenarioIds: named.scenarioIds, replicates: named.replicates, maxConcurrency: named.maxConcurrency }
		: {}),
	...(args.has("experiment-id") ? { experimentId: args.get("experiment-id") } : {}),
	...(args.has("replicates") ? { replicates: Number(args.get("replicates")) } : {}),
	...(args.has("max-concurrency") ? { maxConcurrency: Number(args.get("max-concurrency")) } : {}),
	...(args.has("targets") ? { targetIds: args.get("targets")?.split(",").filter(Boolean) } : {}),
	...(args.has("scenarios") ? { scenarioIds: args.get("scenarios")?.split(",").filter(Boolean) } : {}),
});

const render = new Render(
	useLocalDev ? { useLocalDev: true, ...(process.env.RENDER_LOCAL_DEV_URL ? { localDevUrl: process.env.RENDER_LOCAL_DEV_URL } : {}) } : undefined,
);
const taskSlug = useLocalDev ? TASKS.runExperiment : `${workflowSlug}/${TASKS.runExperiment}`;
const started = await render.workflows.startTask(taskSlug, [input]);
console.log(JSON.stringify({ taskRunId: started.taskRunId, experimentId: input.experimentId ?? null }));
