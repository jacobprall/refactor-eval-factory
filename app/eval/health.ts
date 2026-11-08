import { posix } from "node:path";
import ts from "typescript";

/**
 * A transparent structural-health proxy, scored like CodeScene's Code Health (10 is best, 1 is worst) but not equivalent to it.
 * Thresholds and penalties were fixed before any evaluation run so they cannot be tuned to a target.
 */
export const AI_FRIENDLY_HEALTH = 9.5;

export type HealthFindingKind =
	| "complex_method"
	| "deep_nesting"
	| "bumpy_road"
	| "large_method"
	| "excess_arguments"
	| "complex_conditional"
	| "duplicated_block"
	| "large_file";

export interface HealthFinding {
	kind: HealthFindingKind;
	symbol: string;
	line: number;
	value: number;
}

export interface FileHealth {
	path: string;
	score: number;
	lines: number;
	findings: HealthFinding[];
}

export interface HealthSnapshot {
	score: number;
	lines: number;
	files: FileHealth[];
	/** Module structure, recorded beside the score and never folded into it. */
	boundaries?: ModuleBoundaries;
}

export interface BoundaryViolation {
	from: string;
	to: string;
}

/**
 * For code organized as `src/<module>/...`: imports between modules, and the ones that bypass the target module's
 * `index.ts`. The composition root (`src/index.ts`) wires modules together and is exempt.
 */
export interface ModuleBoundaries {
	modules: number;
	crossModuleImports: number;
	violations: BoundaryViolation[];
}

const PENALTY: Record<HealthFindingKind, number> = {
	complex_method: 1,
	deep_nesting: 1,
	large_method: 1,
	bumpy_road: 0.5,
	excess_arguments: 0.5,
	complex_conditional: 0.5,
	duplicated_block: 0.5,
	large_file: 0.5,
};

const COMPLEX_METHOD_CYCLOMATIC = 10;
const DEEP_NESTING_DEPTH = 4;
const LARGE_METHOD_LINES = 70;
const BUMP_DEPTH = 2;
const BUMPY_ROAD_BUMPS = 2;
const EXCESS_ARGUMENTS = 4;
const COMPLEX_CONDITIONAL_OPERATORS = 3;
const DUPLICATE_WINDOW_LINES = 6;
const LARGE_FILE_LINES = 400;
const VERY_LARGE_FILE_LINES = 800;
const MAX_FINDINGS_PER_FILE = 25;

const SOURCE_PATH = /^(?:src|app|lib)\/.+\.[cm]?[jt]sx?$/;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

export function isProductionSource(path: string): boolean {
	return SOURCE_PATH.test(path) && !TEST_PATH.test(path);
}

export function analyzeHealth(sources: Readonly<Record<string, string>>): HealthSnapshot {
	const paths = Object.keys(sources).filter(isProductionSource).sort();
	const duplicates = duplicatedBlocks(Object.fromEntries(paths.map((path) => [path, sources[path]])));
	const files = paths.map((path) => fileHealth(path, sources[path], duplicates.get(path) ?? []));
	const lines = files.reduce((total, file) => total + file.lines, 0);
	const score = lines === 0 ? 10 : files.reduce((total, file) => total + file.score * file.lines, 0) / lines;
	const boundaries = moduleBoundaries(Object.fromEntries(paths.map((path) => [path, sources[path]])));
	return { score: round(score), lines, files, ...(boundaries ? { boundaries } : {}) };
}

const MAX_BOUNDARY_VIOLATIONS = 50;

function moduleOf(path: string): string | undefined {
	const parts = path.split("/");
	return parts[0] === "src" && parts.length >= 3 ? parts[1] : undefined;
}

export function moduleBoundaries(sources: Readonly<Record<string, string>>): ModuleBoundaries | undefined {
	const modules = new Set(
		Object.keys(sources)
			.map(moduleOf)
			.filter((module): module is string => module !== undefined),
	);
	if (modules.size < 2) return undefined;
	let crossModuleImports = 0;
	const violations: BoundaryViolation[] = [];
	for (const [path, text] of Object.entries(sources)) {
		const from = moduleOf(path);
		if (!from) continue;
		for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
			if (!fileName.startsWith(".")) continue;
			const target = posix.normalize(posix.join(posix.dirname(path), fileName));
			const to = moduleOf(target);
			if (!to || to === from) continue;
			crossModuleImports++;
			if (!/^src\/[^/]+\/index\.[cm]?[jt]sx?$/.test(target)) violations.push({ from: path, to: target });
		}
	}
	return { modules: modules.size, crossModuleImports, violations: violations.slice(0, MAX_BOUNDARY_VIOLATIONS) };
}

/**
 * Findings present in `after` but not in `before`. Functions match by kind and symbol so unrelated line shifts are ignored;
 * duplicated blocks have no stable name, so they match by count.
 */
export function newFindings(before: FileHealth | undefined, after: FileHealth): HealthFinding[] {
	const known = new Map<string, number>();
	for (const finding of before?.findings ?? []) known.set(findingKey(finding), (known.get(findingKey(finding)) ?? 0) + 1);
	return after.findings.filter((finding) => {
		const remaining = known.get(findingKey(finding)) ?? 0;
		known.set(findingKey(finding), remaining - 1);
		return remaining <= 0;
	});
}

const findingKey = (finding: HealthFinding) => `${finding.kind}:${finding.kind === "duplicated_block" ? "" : finding.symbol}`;

function fileHealth(path: string, text: string, duplicateFindings: HealthFinding[]): FileHealth {
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
	const findings: HealthFinding[] = [];
	const visit = (node: ts.Node) => {
		if (isFunctionWithBody(node)) findings.push(...functionFindings(node, source));
		ts.forEachChild(node, visit);
	};
	visit(source);
	findings.push(...duplicateFindings);
	const lines = text.split("\n").filter((line) => line.trim() !== "").length;
	if (lines > LARGE_FILE_LINES) findings.push({ kind: "large_file", symbol: path, line: 1, value: lines });

	let penalty = findings.reduce((total, finding) => total + PENALTY[finding.kind], 0);
	if (lines > VERY_LARGE_FILE_LINES) penalty += PENALTY.large_file;
	findings.sort((a, b) => PENALTY[b.kind] - PENALTY[a.kind] || a.line - b.line);
	return { path, score: Math.max(1, 10 - penalty), lines, findings: findings.slice(0, MAX_FINDINGS_PER_FILE) };
}

type FunctionWithBody = ts.FunctionLikeDeclaration & { body: ts.Node };

function isFunctionWithBody(node: ts.Node): node is FunctionWithBody {
	return (
		(ts.isFunctionDeclaration(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isConstructorDeclaration(node) ||
			ts.isGetAccessorDeclaration(node) ||
			ts.isSetAccessorDeclaration(node) ||
			ts.isFunctionExpression(node) ||
			ts.isArrowFunction(node)) &&
		node.body !== undefined
	);
}

function functionFindings(fn: FunctionWithBody, source: ts.SourceFile): HealthFinding[] {
	const symbol = functionName(fn, source);
	const line = source.getLineAndCharacterOfPosition(fn.getStart(source)).line + 1;
	const endLine = source.getLineAndCharacterOfPosition(fn.end).line + 1;
	const findings: HealthFinding[] = [];
	const add = (kind: HealthFindingKind, value: number) => findings.push({ kind, symbol, line, value });

	const cyclomatic = 1 + countWithin(fn.body, isDecisionPoint);
	if (cyclomatic >= COMPLEX_METHOD_CYCLOMATIC) add("complex_method", cyclomatic);

	const depth = nestingDepth(fn.body, 0);
	if (depth >= DEEP_NESTING_DEPTH) add("deep_nesting", depth);

	if (ts.isBlock(fn.body)) {
		const bumps = fn.body.statements.filter((statement) => nestingDepth(statement, 0) >= BUMP_DEPTH).length;
		if (bumps >= BUMPY_ROAD_BUMPS) add("bumpy_road", bumps);
	}

	const lines = endLine - line + 1;
	if (lines > LARGE_METHOD_LINES) add("large_method", lines);
	if (fn.parameters.length > EXCESS_ARGUMENTS) add("excess_arguments", fn.parameters.length);

	const operators = maxConditionOperators(fn.body);
	if (operators >= COMPLEX_CONDITIONAL_OPERATORS) add("complex_conditional", operators);
	return findings;
}

function functionName(fn: FunctionWithBody, source: ts.SourceFile): string {
	const owner = ts.isClassLike(fn.parent) && fn.parent.name ? `${fn.parent.name.text}.` : "";
	if (ts.isConstructorDeclaration(fn)) return `${owner}constructor`;
	if (fn.name) return `${owner}${fn.name.getText(source)}`;
	const parent = fn.parent;
	if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.name) {
		return `${owner}${parent.name.getText(source)}`;
	}
	return `<anonymous>@${source.getLineAndCharacterOfPosition(fn.getStart(source)).line + 1}`;
}

const LOGICAL_OPERATORS = new Set([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
	ts.SyntaxKind.AmpersandAmpersandEqualsToken,
	ts.SyntaxKind.BarBarEqualsToken,
	ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isDecisionPoint(node: ts.Node): boolean {
	return (
		ts.isIfStatement(node) ||
		ts.isConditionalExpression(node) ||
		ts.isCaseClause(node) ||
		ts.isForStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node) ||
		ts.isCatchClause(node) ||
		(ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind))
	);
}

/** Counts matching nodes without descending into nested functions, which are scored on their own. */
function countWithin(root: ts.Node, matches: (node: ts.Node) => boolean): number {
	let count = 0;
	const visit = (node: ts.Node) => {
		if (isFunctionWithBody(node)) return;
		if (matches(node)) count++;
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(root, visit);
	return count;
}

function nestingDepth(node: ts.Node, depth: number): number {
	if (isFunctionWithBody(node)) return depth;
	if (ts.isIfStatement(node)) {
		const inner = depth + 1;
		let max = Math.max(inner, nestingDepth(node.thenStatement, inner));
		if (node.elseStatement) {
			// An else-if chain is one decision ladder, not deeper nesting.
			max = Math.max(max, nestingDepth(node.elseStatement, ts.isIfStatement(node.elseStatement) ? depth : inner));
		}
		return max;
	}
	const nests =
		ts.isForStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node) ||
		ts.isSwitchStatement(node) ||
		ts.isCatchClause(node);
	const inner = nests ? depth + 1 : depth;
	let max = inner;
	ts.forEachChild(node, (child) => {
		max = Math.max(max, nestingDepth(child, inner));
	});
	return max;
}

function maxConditionOperators(root: ts.Node): number {
	let max = 0;
	const visit = (node: ts.Node) => {
		if (isFunctionWithBody(node)) return;
		const condition =
			ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
				? node.expression
				: ts.isConditionalExpression(node)
					? node.condition
					: undefined;
		if (condition) max = Math.max(max, countWithin(condition, isLogicalOperator) + (isLogicalOperator(condition) ? 1 : 0));
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(root, visit);
	return max;
}

const isLogicalOperator = (node: ts.Node) =>
	ts.isBinaryExpression(node) &&
	(node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken);

interface NormalizedLine {
	text: string;
	line: number;
}

/** Exact duplicated windows of meaningful lines, within and across production files. */
function duplicatedBlocks(sources: Readonly<Record<string, string>>): Map<string, HealthFinding[]> {
	const normalized = new Map<string, NormalizedLine[]>();
	const windows = new Map<string, { path: string; start: number }[]>();
	for (const [path, text] of Object.entries(sources)) {
		const lines = text
			.split("\n")
			.map((raw, index) => ({ text: raw.trim(), line: index + 1 }))
			.filter(({ text }) => text !== "" && !/^[{}()[\];,]*$/.test(text) && !/^(?:import\s|export\s+\*|\/\/|\/\*|\*)/.test(text));
		normalized.set(path, lines);
		for (let start = 0; start + DUPLICATE_WINDOW_LINES <= lines.length; start++) {
			const key = lines
				.slice(start, start + DUPLICATE_WINDOW_LINES)
				.map(({ text }) => text)
				.join("\n");
			windows.set(key, [...(windows.get(key) ?? []), { path, start }]);
		}
	}

	const marked = new Map<string, Set<number>>();
	for (const occurrences of windows.values()) {
		if (occurrences.length < 2) continue;
		for (const occurrence of occurrences) {
			const elsewhere = occurrences.some(
				(other) => other.path !== occurrence.path || Math.abs(other.start - occurrence.start) >= DUPLICATE_WINDOW_LINES,
			);
			if (!elsewhere) continue;
			const set = marked.get(occurrence.path) ?? new Set<number>();
			for (let index = occurrence.start; index < occurrence.start + DUPLICATE_WINDOW_LINES; index++) set.add(index);
			marked.set(occurrence.path, set);
		}
	}

	const findings = new Map<string, HealthFinding[]>();
	for (const [path, indexes] of marked) {
		const lines = normalized.get(path) ?? [];
		const sorted = [...indexes].sort((a, b) => a - b);
		const blocks: HealthFinding[] = [];
		let runStart = sorted[0];
		for (let i = 1; i <= sorted.length; i++) {
			if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) continue;
			const first = lines[runStart].line;
			const last = lines[sorted[i - 1]].line;
			blocks.push({ kind: "duplicated_block", symbol: `${path}:${first}-${last}`, line: first, value: sorted[i - 1] - runStart + 1 });
			runStart = sorted[i];
		}
		findings.set(path, blocks);
	}
	return findings;
}

function scriptKind(path: string): ts.ScriptKind {
	if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

const round = (value: number) => Math.round(value * 100) / 100;
