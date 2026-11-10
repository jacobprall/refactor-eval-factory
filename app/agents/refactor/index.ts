import { RefactorApplication, RefactorReview, ReplayTrace } from "../../schemas/index.js";
import { defineAgent } from "../define.js";
import { piSonnet } from "../models.js";

/**
 * Reviews a change with the refactoring skill. The skill writes its working files under `.refactor/`, so the agent
 * has write tools; the workflow discards everything it changed before the sandbox is used for anything else.
 */
export const refactorReviewer = defineAgent({
	id: "refactor-reviewer",
	prompt: "refactor/reviewer.md",
	harness: piSonnet,
	tools: ["read", "ls", "bash", "edit", "write"],
	output: RefactorReview,
	maxTurns: 80,
});

/** Applies one approved finding, behind characterization tests. It never sees the replay that grades it. */
export const refactorApplier = defineAgent({
	id: "refactor-applier",
	prompt: "refactor/applier.md",
	harness: piSonnet,
	tools: ["read", "ls", "bash", "edit", "write"],
	output: RefactorApplication,
	maxTurns: 60,
});

/** Writes the replay the guard runs before and after a refactor. Everything it writes is removed before the applier runs. */
export const replayAuthor = defineAgent({
	id: "replay-author",
	prompt: "refactor/replay-author.md",
	harness: piSonnet,
	tools: ["read", "ls", "bash", "write"],
	output: ReplayTrace,
	maxTurns: 30,
});
