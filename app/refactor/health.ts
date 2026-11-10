import ts from "typescript";

/**
 * Two axes, kept apart on purpose. Health asks how hard a file is to change: how hard its functions are to follow
 * (cognitive complexity) and how much of it is a copy of code elsewhere. Heat asks how often it is changed. Thresholds
 * are external defaults (SonarSource's cognitive-complexity limit, jscpd's minimum clone size); the two penalty weights
 * are ours and were fixed before this version was compared with any outcome. Duplicated knowledge that is written
 * differently, module boundaries, and naming are left to review.
 */
export const COGNITIVE_LIMIT = 15;
/** Below this, a file is harder to change than agents handle well. */
export const HEALTH_BAR = 9.5;
const PENALTY_PER_EXCESS_POINT = 0.2;
const PENALTY_PER_DUPLICATED_TENTH = 1;
const CLONE_MIN_TOKENS = 50;
const HEAT_WINDOW = 6;
const MAX_REPORTED_FUNCTIONS = 10;
const MAX_REPORTED_RANGES = 10;

export interface FunctionComplexity {
	symbol: string;
	line: number;
	cognitive: number;
}

export interface LineRange {
	from: number;
	to: number;
}

export interface FileHealth {
	path: string;
	health: number;
	codeLines: number;
	duplicatedLines: number;
	/** Where the copied lines sit, so a brief can point at them; the score uses only their count. */
	copiedRanges: LineRange[];
	complexityExcess: number;
	/** Merges in the recent window that changed this file. */
	heat: number;
	/** The most complex functions, highest first. */
	functions: FunctionComplexity[];
}

export interface HealthSnapshot {
	/** Health of all code, weighted by file length. */
	health: number;
	/** Health of the code recent merges changed, weighted by size times how often; equals `health` without history. */
	healthWhereWorkIs: number;
	files: FileHealth[];
}

/** `sources` holds production files only; `history` lists the paths each earlier merge changed, oldest first. */
export function analyzeHealth(sources: Readonly<Record<string, string>>, history: readonly (readonly string[])[] = []): HealthSnapshot {
	const production = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
	const duplicated = duplicatedLines(production);
	const recent = history.slice(-HEAT_WINDOW);
	const files = Object.entries(production).map(([path, text]): FileHealth => {
		const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
		const functions = functionComplexities(source).sort((a, b) => b.cognitive - a.cognitive);
		const complexityExcess = functions.reduce((total, fn) => total + Math.max(0, fn.cognitive - COGNITIVE_LIMIT), 0);
		const codeLines = text.split("\n").filter((line) => line.trim() !== "").length;
		const copiedLines = duplicated.get(path) ?? new Set<number>();
		const copied = copiedLines.size;
		const duplicationPenalty = codeLines === 0 ? 0 : (copied / codeLines) * 10 * PENALTY_PER_DUPLICATED_TENTH;
		return {
			path,
			health: round(Math.max(1, 10 - complexityExcess * PENALTY_PER_EXCESS_POINT - duplicationPenalty)),
			codeLines,
			duplicatedLines: copied,
			copiedRanges: lineRanges(copiedLines).slice(0, MAX_REPORTED_RANGES),
			complexityExcess,
			heat: recent.filter((changed) => changed.includes(path)).length,
			functions: functions.slice(0, MAX_REPORTED_FUNCTIONS),
		};
	});
	const health = weightedMean(files, (file) => file.codeLines);
	const hot = files.filter((file) => file.heat > 0);
	return { health, healthWhereWorkIs: hot.length > 0 ? weightedMean(hot, (file) => file.heat * file.codeLines) : health, files };
}

function weightedMean(files: readonly FileHealth[], weight: (file: FileHealth) => number): number {
	const total = files.reduce((sum, file) => sum + weight(file), 0);
	return total === 0 ? 10 : round(files.reduce((sum, file) => sum + file.health * weight(file), 0) / total);
}

const round = (value: number) => Math.round(value * 100) / 100;

function lineRanges(lines: ReadonlySet<number>): LineRange[] {
	const ranges: LineRange[] = [];
	for (const line of [...lines].sort((a, b) => a - b)) {
		const last = ranges.at(-1);
		if (last && line === last.to + 1) last.to = line;
		else ranges.push({ from: line, to: line });
	}
	return ranges;
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

function functionComplexities(source: ts.SourceFile): FunctionComplexity[] {
	const results: FunctionComplexity[] = [];
	const visit = (node: ts.Node) => {
		if (isFunctionWithBody(node)) {
			results.push({
				symbol: functionName(node, source),
				line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
				cognitive: cognitiveComplexity(node),
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return results;
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

const LOGICAL_OPERATORS = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);

const isLogical = (node: ts.Node): node is ts.BinaryExpression => ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind);

/**
 * SonarSource cognitive complexity: +1 for each break in linear flow (if, else if, else, ternary, switch, loops, catch,
 * labeled jumps, each run of like logical operators), plus the current nesting depth for the structures that nest.
 * Nested functions are scored on their own, so factory-style modules are not charged for the functions they return.
 */
export function cognitiveComplexity(fn: FunctionWithBody): number {
	let total = 0;
	const visit = (node: ts.Node, nesting: number): void => {
		if (node !== fn && isFunctionWithBody(node)) return;
		if (ts.isIfStatement(node)) {
			total += 1 + nesting;
			visitIfChain(node, nesting);
			return;
		}
		if (ts.isConditionalExpression(node)) {
			total += 1 + nesting;
			visit(node.condition, nesting);
			visit(node.whenTrue, nesting + 1);
			visit(node.whenFalse, nesting + 1);
			return;
		}
		if (
			ts.isSwitchStatement(node) ||
			ts.isForStatement(node) ||
			ts.isForInStatement(node) ||
			ts.isForOfStatement(node) ||
			ts.isWhileStatement(node) ||
			ts.isDoStatement(node) ||
			ts.isCatchClause(node)
		) {
			total += 1 + nesting;
			ts.forEachChild(node, (child) => visit(child, nesting + 1));
			return;
		}
		if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) total += 1;
		if (isLogical(node) && !isLogical(node.parent)) {
			const operators: ts.SyntaxKind[] = [];
			const operands: ts.Node[] = [];
			const flatten = (expression: ts.Node) => {
				if (isLogical(expression)) {
					flatten(expression.left);
					operators.push(expression.operatorToken.kind);
					flatten(expression.right);
				} else {
					operands.push(expression);
				}
			};
			flatten(node);
			total += operators.filter((operator, index) => index === 0 || operator !== operators[index - 1]).length;
			for (const operand of operands) visit(operand, nesting);
			return;
		}
		ts.forEachChild(node, (child) => visit(child, nesting));
	};
	// An else-if continues the same decision without nesting deeper; a plain else is one more break in flow.
	const visitIfChain = (node: ts.IfStatement, nesting: number) => {
		visit(node.expression, nesting);
		visit(node.thenStatement, nesting + 1);
		const otherwise = node.elseStatement;
		if (!otherwise) return;
		total += 1;
		if (ts.isIfStatement(otherwise)) visitIfChain(otherwise, nesting);
		else visit(otherwise, nesting + 1);
	};
	visit(fn.body, 0);
	return total;
}

/** Normalized tokens with every name and literal replaced, skipping imports, re-exports, interfaces, and type aliases. */
function normalizedTokens(path: string, text: string): { text: string; line: number }[] {
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const skipped = source.statements
		.filter(
			(statement) =>
				ts.isImportDeclaration(statement) ||
				ts.isInterfaceDeclaration(statement) ||
				ts.isTypeAliasDeclaration(statement) ||
				(ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined),
		)
		.map((statement) => [statement.getStart(source), statement.end] as const);
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
	const tokens: { text: string; line: number }[] = [];
	for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
		const start = scanner.getTokenStart();
		if (skipped.some(([from, to]) => start >= from && start < to)) continue;
		const placeholder =
			kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier
				? "I"
				: kind === ts.SyntaxKind.NumericLiteral ||
						kind === ts.SyntaxKind.StringLiteral ||
						kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
						kind === ts.SyntaxKind.TemplateHead ||
						kind === ts.SyntaxKind.TemplateMiddle ||
						kind === ts.SyntaxKind.TemplateTail
					? "L"
					: scanner.getTokenText();
		tokens.push({ text: placeholder, line: source.getLineAndCharacterOfPosition(start).line + 1 });
	}
	return tokens;
}

/** Lines of each file that sit inside a renamed-or-exact copy of at least CLONE_MIN_TOKENS tokens found elsewhere. */
function duplicatedLines(sources: Readonly<Record<string, string>>): Map<string, Set<number>> {
	const tokens = new Map(Object.entries(sources).map(([path, text]) => [path, normalizedTokens(path, text)]));
	const windows = new Map<string, { path: string; start: number }[]>();
	for (const [path, list] of tokens) {
		for (let start = 0; start + CLONE_MIN_TOKENS <= list.length; start++) {
			const key = list
				.slice(start, start + CLONE_MIN_TOKENS)
				.map((token) => token.text)
				.join(" ");
			windows.set(key, [...(windows.get(key) ?? []), { path, start }]);
		}
	}
	const lines = new Map<string, Set<number>>();
	for (const occurrences of windows.values()) {
		if (occurrences.length < 2) continue;
		for (const occurrence of occurrences) {
			const elsewhere = occurrences.some((other) => other.path !== occurrence.path || Math.abs(other.start - occurrence.start) >= CLONE_MIN_TOKENS);
			if (!elsewhere) continue;
			const set = lines.get(occurrence.path) ?? new Set<number>();
			const list = tokens.get(occurrence.path) ?? [];
			for (let index = occurrence.start; index < occurrence.start + CLONE_MIN_TOKENS; index++) set.add(list[index].line);
			lines.set(occurrence.path, set);
		}
	}
	return lines;
}
