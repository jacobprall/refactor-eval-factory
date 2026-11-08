#!/usr/bin/env python3
"""Recon for the refactoring skill.

  recon.py profile [--root DIR] [--diff BASE] [--out DIR]
      Fast, read-only project profile: shape, size, pace of change, tests,
      dependencies, tooling, and per-module signal counts that suggest which
      smell cards to load. Writes <out>/profile.json and prints a summary.

  recon.py check
      Validates signals.json, and the smell cards against it when smells/ exists.

Standard library only (Python 3.8+). Uses git when available.
Signals point where to look. They never decide findings.
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent
SIGNALS_PATH = HERE / "signals.json"

LANG_BY_EXT = {
    ".ts": "js", ".tsx": "js", ".mts": "js", ".cts": "js",
    ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
    ".py": "py",
}
DISPLAY_LANG = {
    ".ts": "ts", ".tsx": "ts", ".mts": "ts", ".cts": "ts",
    ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".py": "py",
    ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".rb": "ruby",
    ".php": "php", ".cs": "csharp", ".swift": "swift", ".c": "c", ".h": "c",
    ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp", ".scala": "scala",
    ".ex": "elixir", ".exs": "elixir",
}
SKIP_DIRS = {
    ".git", "node_modules", ".next", ".nuxt", "dist", "build", "out", "coverage",
    ".turbo", ".cache", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", "vendor", "third_party", ".refactor",
    ".svelte-kit", ".vercel", ".output", "target", ".parcel-cache",
}
GENERATED_PATH_RE = re.compile(
    r"(^|/)(__generated__|generated)/|\.generated\.|\.min\.(js|css)$|\.d\.[cm]?ts$|_pb2(_grpc)?\.py$"
)
GENERATED_HEADER_RE = re.compile(
    r"@generated|do not edit|auto-?generated|this file (is|was) generated", re.I
)
TEST_PATH_RE = re.compile(
    r"(^|/)(tests?|__tests__|specs?|e2e|__mocks__|fixtures|__fixtures__|test-fixtures|testdata)/"
    r"|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]*\.py$|_test\.py$|(^|/)conftest\.py$"
)
PACKAGE_MARKERS = ("package.json", "pyproject.toml", "setup.py", "setup.cfg", "go.mod", "Cargo.toml")
CONTAINER_DIRS = {"src", "lib", "app", "apps", "packages", "pkg", "internal", "services", "libs", "modules"}
MAX_FILE_BYTES = 1_000_000
SIZE_CLASSES = [(5_000, "S", 1), (50_000, "M", 4), (500_000, "L", 8), (float("inf"), "XL", 16)]
EXAMPLES_PER_SIGNAL = 8
SCAFFOLD_DIR_RE = re.compile(r"(^|/)(templates?|examples?|scaffolds?|starters?|boilerplates?|samples?)(/|$)")
CO_CHANGE_MAX_SOURCE_FILES = 10
HOTSPOT_HALF_LIFE_DAYS = 30
TOP = 20
MAX_REPEATED_LITERALS = 40

DEP_FAMILIES = {
    "http-client": ["axios", "node-fetch", "got", "superagent", "ky", "undici", "cross-fetch",
                    "isomorphic-fetch", "ofetch", "requests", "httpx", "aiohttp", "urllib3"],
    "date-time": ["moment", "dayjs", "date-fns", "luxon", "arrow", "pendulum", "python-dateutil"],
    "logging": ["winston", "pino", "bunyan", "log4js", "loglevel", "signale", "consola", "loguru", "structlog"],
    "validation": ["zod", "yup", "joi", "ajv", "valibot", "superstruct", "io-ts", "@sinclair/typebox",
                   "class-validator", "pydantic", "marshmallow", "cerberus", "voluptuous"],
    "test-runner": ["jest", "vitest", "mocha", "ava", "jasmine", "pytest", "nose2"],
    "orm-query": ["prisma", "typeorm", "sequelize", "drizzle-orm", "knex", "mongoose", "kysely",
                  "objection", "sqlalchemy", "peewee", "tortoise-orm"],
    "utility": ["lodash", "underscore", "ramda", "remeda", "radash"],
    "id-generation": ["uuid", "nanoid", "cuid", "@paralleldrive/cuid2", "ulid", "shortid"],
    "env-config": ["dotenv", "dotenv-flow", "env-var", "envalid", "convict", "@t3-oss/env-core",
                   "python-dotenv", "environs"],
    "cli": ["commander", "yargs", "meow", "minimist", "cac", "citty", "clipanion", "click", "typer"],
}
DEP_ALIASES = {"@prisma/client": "prisma", "lodash-es": "lodash"}
FAMILY_OF = {lib: fam for fam, libs in DEP_FAMILIES.items() for lib in libs}

AGENT_AUTHOR_RE = re.compile(
    r"claude|anthropic|cursor ?agent|cursoragent|copilot|devin|codex|openai|aider|jules|sweep-ai|"
    r"factory-droid|codegen|windsurf|cline|roo ?code", re.I)
AGENT_TRAILER_RE = re.compile(
    r"^(co-authored-by:.*(claude|anthropic|cursor|copilot|devin|codex|openai|aider|jules|windsurf|cline))"
    r"|generated with \[?(claude|cursor|copilot|codex|devin|aider)", re.I | re.M)
SWEEP_MSG_RE = re.compile(
    r"\b(format|formatting|prettier|lint|eslint|biome|bump|upgrade|deps?|dependencies|license|copyright)\b", re.I)
SWEEP_MAX_FILES = 30

JS_TOKEN_RE = re.compile(
    r"//[^\n]*|/\*.*?\*/|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`", re.S)
PY_TOKEN_RE = re.compile(
    r"#[^\n]*|\"\"\"(?:\\.|[^\\])*?\"\"\"|'''(?:\\.|[^\\])*?'''|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'", re.S)

JS_EXPORT_RE = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum|abstract)\b"
    r"|^export\s*\{([^}]*)\}", re.M)
PY_EXPORT_RE = re.compile(r"^(?:async\s+)?def\s+[A-Za-z]\w*|^class\s+[A-Za-z]\w*", re.M)
TEST_CASE_RE = {
    "js": re.compile(r"\b(?:it|test)(?:\.(?:each|concurrent|only)(?:\([^)]*\))?)?\s*\(\s*['\"`]"),
    "py": re.compile(r"^\s*(?:async\s+)?def\s+test_\w*", re.M),
}
ASSERT_RE = {
    "js": re.compile(r"\bexpect(?:\.\w+)?\s*\(|\bassert(?:\.\w+)?\s*\(|\.should\b|\bt\.(?:is|deepEqual|true|false|truthy|throws)\b"),
    "py": re.compile(r"^\s*assert\b|\bself\.assert\w+\s*\(|\bpytest\.raises\b|\bexpect\(", re.M),
}
MOCK_RE = {
    "js": re.compile(r"\b(?:jest|vi)\.(?:mock|fn|spyOn|doMock)\b|\bsinon\.(?:stub|spy|mock|fake)\b"),
    "py": re.compile(r"\b(?:Mock|MagicMock|AsyncMock|create_autospec)\s*\(|\bpatch(?:\.object|\.dict)?\s*\(|\bmocker\.\w+"),
}
THROW_RE = {"js": re.compile(r"\bthrow\s+new\b"), "py": re.compile(r"\braise\s+\w")}
RESULT_ERR_RE = {
    "js": re.compile(r"return\s*\{\s*(?:ok|success)\s*:\s*false\b|return\s*\{\s*error\s*[:,}]"),
    "py": re.compile(r"return\s+(?:None\s*,\s*\w+|\{\s*['\"]error['\"]|\(\s*False\s*,)"),
}
STRING_LITERAL_RE = re.compile(r"(['\"])((?:(?!\1)[^\\\n]|\\.){4,60})\1")
LITERAL_SHAPE_RE = re.compile(r"^[A-Za-z][\w./:@-]*(?: [\w./:@-]+)*$")
CLASS_LIST_LINE_RE = re.compile(r"className|\bclass=|\bcn\(|\bclsx\(|\bcva\(|\btwMerge\(|\btw`")
IMPORT_LINE_RE = re.compile(r"^\s*(import\b|from\s+\S+\s+import\b|export\s+(\*|\{[^}]*\})\s+from\b|.*\brequire\()")
TRIVIAL_LINE_RE = re.compile(r"^[\s{}()\[\];,]*$|^(return;?|break;?|continue;?|else\s*\{?|\}\s*else\s*\{?|pass|try\s*[:{]?)$")
LITERAL_STOPLIST = {
    "utf-8", "utf8", "use client", "use server", "use strict", "string", "number", "boolean",
    "object", "function", "undefined", "default", "content-type", "Content-Type", "application/json",
    "GET", "POST", "PATCH", "DELETE", "__main__", "error", "true", "false", "null", "none", "None",
}
NAME_STOPLIST = {
    "main", "handler", "default", "constructor", "render", "setup", "init", "__init__", "run", "index",
    "middleware", "loader", "action", "config", "create", "update", "delete", "list", "get", "post",
    "put", "patch", "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "generateMetadata",
    "generateStaticParams", "getServerSideProps", "getStaticProps", "Page", "Layout", "RootLayout",
    "toString", "toJSON", "__repr__", "__str__", "__eq__", "__hash__", "callback", "<anonymous>",
}
JS_CONTROL = {"if", "for", "while", "switch", "catch", "with", "return", "typeof", "await", "new", "else", "do", "try", "finally"}
JS_BRANCH_RE = re.compile(r"\b(?:if|for|while|case|catch)\b|&&|\|\||(?<![?\w])\?(?![.?:])")
PY_BRANCH_RE = re.compile(r"\b(?:if|elif|for|while|except|and|or|case)\b")
_ARG = r"(?:[\w$#.]+|\"\s*\"|'\s*'|\d+)"
QUERY_NAME_RE = {
    "js": re.compile(r"^(?:get|is|has|find|read|check|can|should|lookup)(?:[A-Z_]|$)"),
    "py": re.compile(r"^(?:get|is|has|find|read|check|can|should|lookup)(?:_|$)"),
}
WRITE_RE = {
    "js": re.compile(
        r"\bthis\.[#\w$]+\s*=(?!=)|\.(?:save|insert|update|upsert|delete|remove|write|post|put|patch|emit|send|publish|create)\w*\s*\("
        r"|\bmethod\s*:\s*[\"'](?:POST|PUT|PATCH|DELETE)"),
    "py": re.compile(
        r"\bself\.\w+\s*=(?!=)|\.(?:save|insert|update|upsert|delete|remove|write|post|put|patch|emit|send|publish|create|commit)\w*\s*\("
        r"|\bmethod\s*=\s*[\"'](?:POST|PUT|PATCH|DELETE)"),
}
PASS_THROUGH_RE = {
    "js": re.compile(r"^(?:return\s+)?(?:await\s+)?((?:this\.)?[\w$#]+(?:\.[\w$#]+)*)\(\s*(?:" + _ARG + r"\s*(?:,\s*" + _ARG + r"\s*)*)?\)\s*;?$"),
    "py": re.compile(r"^(?:return\s+)?(?:await\s+)?((?:self\.)?\w+(?:\.\w+)*)\(\s*(?:" + _ARG + r"\s*(?:,\s*" + _ARG + r"\s*)*)?\)$"),
}
BUILTIN_CALLEES = {
    "replace", "replaceAll", "map", "filter", "reduce", "join", "split", "trim", "slice", "substring", "toLowerCase",
    "toUpperCase", "toString", "toFixed", "includes", "startsWith", "endsWith", "some", "every", "find", "flatMap",
    "sort", "concat", "padStart", "padEnd", "test", "match", "exec", "has", "push", "keys", "values", "entries",
    "lower", "upper", "strip", "format", "append", "extend", "get", "items", "len", "str", "int", "float", "bool",
    "list", "dict", "set", "tuple", "sorted", "print", "isinstance", "super",
}
BUILTIN_OBJECTS = {"JSON", "Object", "Math", "Array", "String", "Number", "Promise", "Date", "Buffer", "Reflect", "console", "os", "re", "json"}


def is_pass_through(lang, line):
    m = PASS_THROUGH_RE[lang].match(line)
    if not m:
        return False
    chain = m.group(1).split(".")
    return chain[-1] not in BUILTIN_CALLEES and chain[0] not in BUILTIN_OBJECTS


# ---------------------------------------------------------------- utilities

def git(root, *args):
    try:
        r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, errors="replace")
    except FileNotFoundError:
        return None
    return r.stdout if r.returncode == 0 else None


def percentile(values, pct):
    if not values:
        return 0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(math.ceil(pct / 100.0 * len(s))) - 1))
    return s[k]


def blank(s):
    return re.sub(r"[^\n]", " ", s)


def strip_code(text, lang):
    """Return (no_comments, no_comments_or_strings), both length-preserving."""
    token_re = JS_TOKEN_RE if lang == "js" else PY_TOKEN_RE

    def drop_comment(m):
        t = m.group(0)
        return blank(t) if t[0] in "/#" else t

    def drop_all(m):
        t = m.group(0)
        if t[0] in "/#":
            return blank(t)
        q = 3 if t[:3] in ('"""', "'''") else 1
        return t[:q] + blank(t[q:-q]) + t[-q:] if len(t) >= 2 * q else blank(t)

    return token_re.sub(drop_comment, text), token_re.sub(drop_all, text)


class Lines:
    def __init__(self, text):
        self.starts = [0] + [m.end() for m in re.finditer(r"\n", text)]

    def line(self, pos):
        return bisect.bisect_right(self.starts, pos)  # 1-based


def match_back(s, close_idx, open_ch="(", close_ch=")"):
    depth = 0
    for i in range(close_idx, -1, -1):
        c = s[i]
        if c == close_ch:
            depth += 1
        elif c == open_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1


def match_forward(s, open_idx, open_ch="(", close_ch=")"):
    depth = 0
    for i in range(open_idx, len(s)):
        c = s[i]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1


def count_params(inner):
    inner = inner.strip()
    if not inner:
        return 0
    depth, n = 0, 1
    for c in inner:
        if c in "([{<":
            depth += 1
        elif c in ")]}>":
            depth -= 1
        elif c == "," and depth == 0:
            n += 1
    if inner.rstrip().endswith(","):
        n -= 1
    return n


# ---------------------------------------------------------------- functions

SIG_CLOSE_RE = re.compile(r"\)(\s*:[^(){};=]*)?$")
ARROW_NAME_RES = [
    re.compile(r"([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?$"),
    re.compile(r"([\w$]+)\s*:\s*(?:async\s*)?$"),
    re.compile(r"([\w$]+(?:\.[\w$]+)*)\s*\(\s*(?:[^()]*,\s*)?(?:async\s*)?$"),
]


def enclosing_call(head):
    """Name of the call whose argument list `head` ends inside, e.g. 'task' for 'task({...}, async'."""
    depth = 0
    for i in range(len(head) - 1, -1, -1):
        c = head[i]
        if c in ")]}":
            depth += 1
        elif c in "([{":
            if depth == 0:
                if c != "(":
                    return None
                w = re.search(r"([\w$]+(?:\.[\w$]+)*)\s*(?:<[^<>]*>)?\s*$", head[:i])
                return w.group(1) if w else None
            depth -= 1
    return None


def js_head(s, pos):
    """Classify the '{' at pos. Returns (info, is_block): info is (name, params, head_pos)
    when the brace opens a function body; is_block is False for object literals and types."""
    pre = s[max(0, pos - 600):pos].rstrip()
    base = pos - 600 if pos > 600 else 0
    if pre.endswith("=>"):
        before = pre[:-2].rstrip()
        m = SIG_CLOSE_RE.search(before)
        if m:
            close = m.start()
            open_ = match_back(before, close)
            if open_ < 0:
                return None, True
            params = count_params(before[open_ + 1:close])
            head = before[:open_]
        else:
            w = re.search(r"([\w$]+)$", before)
            if not w:
                return None, True
            params, head, open_ = 1, before[:w.start()], w.start()
        name = "<anonymous>"
        h = head.rstrip()
        for i, rx in enumerate(ARROW_NAME_RES):
            mm = rx.search(h)
            if mm:
                name = mm.group(1) + (" callback" if i == 2 else "")
                break
        else:
            callee = enclosing_call(h)
            if callee:
                name = callee + " callback"
        return (name, params, base + open_), True
    m = SIG_CLOSE_RE.search(pre)
    if m:
        close = m.start()
        open_ = match_back(pre, close)
        if open_ < 0:
            return None, True
        head = pre[:open_].rstrip()
        if head.endswith(">"):
            g = match_back(head, len(head) - 1, "<", ">")
            if g >= 0:
                head = head[:g].rstrip()
        w = re.search(r"([\w$]+)\s*\*?$", head)
        word = w.group(1) if w else ""
        if word in JS_CONTROL:
            return None, True
        params = count_params(pre[open_ + 1:close])
        if word == "function" or not word:
            mm = re.search(r"([\w$]+)\s*[:=]\s*(?:async\s+)?function\s*\*?$", head)
            name = mm.group(1) if mm else ("default" if re.search(r"default\s+(?:async\s+)?function\s*\*?$", head) else "<anonymous>")
        else:
            name = word
        return (name, params, base + (w.start() if w else open_)), True
    block = bool(re.search(r"(?:\belse|\btry|\bfinally|\bdo)$", pre))
    return None, block


def js_functions(code):
    lines = Lines(code)
    funcs, stack, open_funcs = [], [], []
    block_depth = 0
    for m in re.finditer(r"[{}]", code):
        pos = m.start()
        if m.group() == "{":
            info, is_block = js_head(code, pos)
            if is_block:
                block_depth += 1
            rec = None
            if info:
                name, params, head = info
                rec = {"name": name, "params": params, "start": lines.line(head), "open": pos,
                       "bdepth": block_depth, "nest": 0, "top": not open_funcs and not stack}
                funcs.append(rec)
                open_funcs.append(rec)
            elif is_block:
                for f in open_funcs:
                    f["nest"] = max(f["nest"], block_depth - f["bdepth"])
            stack.append((rec, is_block))
        else:
            if not stack:
                continue
            rec, is_block = stack.pop()
            if is_block:
                block_depth -= 1
            if rec:
                rec["end"] = lines.line(pos)
                rec["close"] = pos
                open_funcs.remove(rec)
    out = []
    for f in funcs:
        if "close" not in f:
            continue
        body = code[f["open"] + 1:f["close"]]
        body_lines = [l.strip() for l in body.split("\n") if l.strip()]
        out.append({
            "name": f["name"], "start": f["start"], "length": f["end"] - f["start"] + 1,
            "params": f["params"], "nest": f["nest"], "top": f["top"],
            "branches": len(JS_BRANCH_RE.findall(body)),
            "pass_through": (len(body_lines) == 1 and f["name"] not in ("<anonymous>", "constructor")
                             and not f["name"].endswith(" callback")
                             and is_pass_through("js", body_lines[0])),
            "query_writes": bool(QUERY_NAME_RE["js"].match(f["name"]) and WRITE_RE["js"].search(body)),
        })
    return out


PY_DEF_RE = re.compile(r"^([ \t]*)(?:async[ \t]+)?def[ \t]+(\w+)[ \t]*\(", re.M)


def py_functions(code):
    lines = Lines(code)
    src = code.split("\n")
    out = []
    for m in PY_DEF_RE.finditer(code):
        indent = len(m.group(1).expandtabs(4))
        open_ = m.end() - 1
        close = match_forward(code, open_)
        if close < 0:
            continue
        params = [p.strip().split(":")[0].split("=")[0].strip() for p in code[open_ + 1:close].split(",")]
        params = [p for p in params if p and p not in ("self", "cls", "*", "/")]
        start = lines.line(m.start())
        sig_end = lines.line(close)
        colon_line = src[sig_end - 1]
        after = colon_line[colon_line.find(":", close - lines.starts[sig_end - 1]) + 1:].strip() if ":" in colon_line else ""
        body, body_indent, end = [], None, sig_end
        if after:
            body = [(indent + 4, after)]
        else:
            for i in range(sig_end, len(src)):
                raw = src[i]
                if not raw.strip():
                    continue
                ind = len(raw) - len(raw.lstrip(" \t"))
                ind = len(raw[:ind].expandtabs(4))
                if ind <= indent:
                    break
                if body_indent is None:
                    body_indent = ind
                body.append((ind, raw.strip()))
                end = i + 1
        if body_indent is None:
            body_indent = indent + 4
        unit = max(1, body_indent - indent)
        nest = max([(ind - body_indent) // unit for ind, _ in body] or [0])
        text = "\n".join(t for _, t in body)
        out.append({
            "name": m.group(2), "start": start, "length": end - start + 1, "params": len(params),
            "nest": nest, "top": indent == 0, "branches": len(PY_BRANCH_RE.findall(text)),
            "pass_through": (len(body) == 1 and not m.group(2).startswith("__")
                             and is_pass_through("py", body[0][1])),
            "query_writes": bool(QUERY_NAME_RE["py"].match(m.group(2)) and WRITE_RE["py"].search(text)),
        })
    return out


# ---------------------------------------------------------------- discovery

def discover(root):
    out = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    if out is not None:
        paths = [p for p in out.split("\0") if p]
    else:
        paths = []
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
            for f in files:
                paths.append(os.path.relpath(os.path.join(d, f), root))
    keep = []
    for p in sorted(set(paths)):
        parts = p.split("/")
        if any(x in SKIP_DIRS for x in parts[:-1]):
            continue
        if (root / p).is_file():
            keep.append(p)
    return keep


def package_roots(paths):
    roots = {""}
    for p in paths:
        d, _, name = p.rpartition("/")
        if name in PACKAGE_MARKERS:
            roots.add(d)
    return sorted(roots, key=len, reverse=True)


def module_of(path, roots):
    d = path.rpartition("/")[0]
    pkg = next(r for r in roots if r == "" or d == r or d.startswith(r + "/"))
    rel = d[len(pkg):].lstrip("/")
    parts = rel.split("/") if rel else []
    if not parts:
        seg = []
    elif parts[0] in CONTAINER_DIRS and len(parts) >= 2:
        seg = parts[:2]
    elif parts[0] in CONTAINER_DIRS:
        # a flat src/ or app/: each file is its own module
        stem = path.rpartition("/")[2].split(".")[0]
        seg = [parts[0], stem]
    else:
        seg = parts[:1]
    mod = "/".join([x for x in [pkg] + seg if x])
    return mod or "."


def next_segment(module, path):
    """The module one directory deeper than `module` that contains `path`, or None."""
    d = path.rpartition("/")[0]
    prefix = "" if module == "." else module + "/"
    if not d.startswith(prefix) or d == module:
        return None
    rest = d[len(prefix):]
    return prefix + rest.split("/")[0] if rest else None


# ---------------------------------------------------------------- manifests and tooling

def read_json(p):
    try:
        return json.loads(p.read_text(errors="replace"))
    except (OSError, ValueError):
        return None


def parse_deps_text(name, text):
    deps = set()
    if name == "package.json":
        try:
            j = json.loads(text)
        except ValueError:
            return deps
        for k in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            deps.update((j.get(k) or {}).keys())
    elif name.startswith("requirements") and name.endswith(".txt"):
        for line in text.splitlines():
            line = line.split("#")[0].strip()
            if line and not line.startswith("-"):
                deps.add(re.split(r"[\s<>=~!;\[]", line, 1)[0].lower())
    elif name == "pyproject.toml":
        for block in re.findall(r"(?:^|\n)\s*(?:dependencies|dev|test|[\w-]+)\s*=\s*\[(.*?)\]", text, re.S):
            for q in re.findall(r"['\"]([A-Za-z0-9_.\-]+)", block):
                deps.add(q.lower())
        for sect in re.findall(r"\[tool\.poetry\.(?:dev-|group\.\w+\.)?dependencies\](.*?)(?:\n\[|\Z)", text, re.S):
            for k in re.findall(r"^\s*([A-Za-z0-9_.\-]+)\s*=", sect, re.M):
                if k.lower() != "python":
                    deps.add(k.lower())
    return {DEP_ALIASES.get(d, d) for d in deps}


def is_manifest(path):
    n = path.rpartition("/")[2]
    return n == "package.json" or n == "pyproject.toml" or (n.startswith("requirements") and n.endswith(".txt"))


def detect_tooling(root, paths, deps_by_manifest):
    names = set(paths)
    all_deps = set().union(*deps_by_manifest.values()) if deps_by_manifest else set()
    pm = "npm"
    for lock, tool in (("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lock", "bun"), ("bun.lockb", "bun")):
        if lock in names:
            pm = tool
    packages = []
    for p in paths:
        if p.rpartition("/")[2] != "package.json":
            continue
        j = read_json(root / p) or {}
        scripts = j.get("scripts") or {}
        entry = {"package": p.rpartition("/")[0] or "."}
        for key, cands in (("test", ["test"]), ("lint", ["lint"]), ("typecheck", ["typecheck", "type-check", "types", "check-types", "tsc"]), ("build", ["build"])):
            for c in cands:
                if c in scripts:
                    entry[key] = f"{pm} test" if c == "test" else f"{pm} run {c}"
                    break
        packages.append(entry)
    py = {}
    if any(p.endswith(".py") for p in paths):
        if "pytest" in all_deps or "pytest.ini" in names or any(p.endswith("conftest.py") for p in paths):
            py["test"] = "pytest"
        if "ruff" in all_deps or "ruff.toml" in names or ".ruff.toml" in names:
            py["lint"] = "ruff check"
        if "mypy" in all_deps or "mypy.ini" in names:
            py["typecheck"] = "mypy ."
        elif "pyright" in all_deps or "pyrightconfig.json" in names:
            py["typecheck"] = "pyright"
    unused = []
    if "knip" in all_deps or any(n.rpartition("/")[2].startswith("knip.") for n in names):
        unused.append("knip")
    if "ts-prune" in all_deps:
        unused.append("ts-prune")
    if any(n.rpartition("/")[2] == "tsconfig.json" for n in names):
        unused.append("tsc --noUnusedLocals --noUnusedParameters")
    if "eslint" in all_deps:
        unused.append("eslint (no-unused-vars)")
    if "@biomejs/biome" in all_deps or "biome.json" in names or "biome.jsonc" in names:
        unused.append("biome (noUnusedVariables, noUnusedImports)")
    if "ruff" in all_deps or "lint" in py:
        unused.append("ruff (F401, F841)")
    if "vulture" in all_deps:
        unused.append("vulture")
    ci = [p for p in paths if p.startswith(".github/workflows/") or p in (".gitlab-ci.yml", ".circleci/config.yml", "render.yaml")]
    return {"package_manager": pm, "packages": packages, "python": py, "unused_code": unused, "ci": ci}


# ---------------------------------------------------------------- git

RENAME_BRACE_RE = re.compile(r"\{([^{}]*) => ([^{}]*)\}")


def norm_numstat_path(p):
    p = RENAME_BRACE_RE.sub(lambda m: m.group(2), p)
    if " => " in p:
        p = p.split(" => ")[1]
    return p.replace("//", "/")


def git_history(root, window_days):
    out = git(root, "log", f"--since={window_days}.days", "--no-merges", "--numstat",
              "--format=%x1e%H%x1f%at%x1f%an%x1f%ae%x1f%B%x1d")
    if out is None:
        return None
    commits = []
    for rec in out.split("\x1e")[1:]:
        head, _, files = rec.partition("\x1d")
        parts = head.split("\x1f")
        if len(parts) < 5:
            continue
        sha, ts, an, ae, body = parts[0], int(parts[1]), parts[2], parts[3], parts[4]
        changed = []
        for line in files.strip().splitlines():
            cols = line.split("\t")
            if len(cols) == 3:
                a = int(cols[0]) if cols[0].isdigit() else 0
                d = int(cols[1]) if cols[1].isdigit() else 0
                changed.append((norm_numstat_path(cols[2]), a, d))
        agent = bool(AGENT_AUTHOR_RE.search(an + " " + ae) or AGENT_TRAILER_RE.search(body))
        subject = body.strip().splitlines()[0] if body.strip() else ""
        commits.append({"sha": sha, "ts": ts, "author": an, "agent": agent, "subject": subject, "files": changed})
    added = git(root, "log", "--since=30.days", "--no-merges", "--diff-filter=A", "--name-only", "--format=") or ""
    return commits, {p for p in added.splitlines() if p}


# ---------------------------------------------------------------- profile

class Profile:
    def __init__(self, root, signals, window_days, co_change_min, diff_base):
        self.root = root
        self.signals = signals
        self.window_days = window_days
        self.co_change_min = co_change_min
        self.diff_base = diff_base
        self.excluded = Counter()
        self.files = {}          # path -> info
        self.hits = defaultdict(lambda: defaultdict(lambda: {"count": 0, "examples": []}))  # module -> key -> hit
        self.items = defaultdict(list)  # metric key -> list of items (repo level)
        self.scope = None        # None = whole repo, else set of paths

    # -- helpers
    def in_scope(self, path):
        return self.scope is None or path in self.scope

    def hit(self, key, path, line=None, n=1, detail=None):
        if not self.in_scope(path):
            return
        h = self.hits[self.files[path]["module"] if path in self.files else self.module(path)][key]
        h["count"] += n
        if len(h["examples"]) < EXAMPLES_PER_SIGNAL:
            ex = f"{path}:{line}" if line else path
            if detail:
                ex += f" ({detail})"
            h["examples"].append(ex)

    def module(self, path):
        m = module_of(path, self.roots)
        while m in self.splits:
            deeper = next_segment(m, path)
            if not deeper:
                break
            m = deeper
        return m

    def split_large_modules(self):
        """Split oversized directory modules one level deeper until each is a reasonable work unit."""
        self.splits = set()
        total = sum(f["loc"] for f in self.files.values() if f["lang"])
        cap = max(3000, total // 10)
        for _ in range(4):
            sizes = Counter()
            for f in self.files.values():
                if f["lang"]:
                    sizes[f["module"]] += f["loc"]
            big = {m for m, loc in sizes.items() if loc > cap and any(
                next_segment(m, p) for p, f in self.files.items() if f["module"] == m)}
            if not big:
                return
            self.splits |= big
            for p, f in self.files.items():
                if f["module"] in big:
                    f["module"] = self.module(p)

    # -- stages
    def collect(self):
        paths = discover(self.root)
        self.roots = package_roots(paths)
        scaffolds = [r for r in self.roots if r and SCAFFOLD_DIR_RE.search(r)]
        if scaffolds:
            kept = []
            for p in paths:
                if any(p == r or p.startswith(r + "/") for r in scaffolds):
                    if DISPLAY_LANG.get(os.path.splitext(p)[1].lower()):
                        self.excluded["template or example package"] += 1
                    continue
                kept.append(p)
            paths = kept
            self.roots = [r for r in self.roots if r not in scaffolds]
        self.scaffolds = scaffolds
        self.all_paths = paths
        self.splits = set()
        for p in paths:
            ext = os.path.splitext(p)[1].lower()
            lang = LANG_BY_EXT.get(ext)
            disp = DISPLAY_LANG.get(ext)
            if not disp:
                continue
            if GENERATED_PATH_RE.search(p):
                self.excluded["generated path"] += 1
                continue
            full = self.root / p
            try:
                size = full.stat().st_size
            except OSError:
                continue
            if size > MAX_FILE_BYTES:
                self.excluded["over 1 MB"] += 1
                continue
            text = full.read_text(errors="replace")
            if GENERATED_HEADER_RE.search(text[:400]):
                self.excluded["generated header"] += 1
                continue
            loc = sum(1 for l in text.split("\n") if l.strip())
            info = {"lang": lang, "display": disp, "loc": loc, "test": bool(TEST_PATH_RE.search(p)),
                    "module": self.module(p)}
            if lang:
                info["text"] = text
                info["code"], info["bare"] = strip_code(text, lang)
                code_lines = info["code"].split("\n")
                raw_lines = text.split("\n")
                info["comment_lines"] = sum(1 for r, c in zip(raw_lines, code_lines) if r.strip() and not c.strip())
            self.files[p] = info

    def source_files(self):
        return [p for p, f in self.files.items() if f["lang"] and not f["test"]]

    def test_files(self):
        return [p for p, f in self.files.items() if f["lang"] and f["test"]]

    def run_text_signals(self):
        compiled = []
        for card, c in self.signals["cards"].items():
            for name, s in c["signals"].items():
                key = f"{card}.{name}"
                if s["kind"] == "grep":
                    pats = {lang: re.compile(rx, re.M) for lang, rx in s["patterns"].items()}
                    excl = re.compile(s["exclude_path"]) if s.get("exclude_path") else None
                    compiled.append(("grep", key, s, pats, excl))
                elif s["kind"] == "path":
                    compiled.append(("path", key, s, re.compile(s["pattern"]), None))
        for kind, key, s, pat, excl in compiled:
            if kind == "path":
                pool = self.all_paths if s["files"] == "all" else [p for p in self.files if self.files[p]["lang"] and self.wants(p, s["files"])]
                for p in pool:
                    if pat.search(p):
                        self.hit(key, p)
                continue
            for p, f in self.files.items():
                if not f["lang"] or f["lang"] not in pat or not self.wants(p, s["files"]):
                    continue
                if excl and excl.search(p):
                    continue
                text = f["text"] if s.get("text") == "raw" else f["code"]
                matches = list(pat[f["lang"]].finditer(text))
                if matches:
                    ln = Lines(text)
                    self.hit(key, p, line=ln.line(matches[0].start()), n=len(matches))

    def wants(self, path, which):
        f = self.files[path]
        return which == "all" or (which == "test") == f["test"]

    def run_metrics(self):
        src = self.source_files()
        tests = self.test_files()
        # sizes
        src_locs = [self.files[p]["loc"] for p in src]
        large_cut = max(150, percentile(src_locs, 95))
        for p in src:
            if self.files[p]["loc"] >= large_cut:
                self.hit("overloaded-module.large-file", p, detail=f"{self.files[p]['loc']} lines")
                self.items["overloaded-module.large-file"].append({"path": p, "loc": self.files[p]["loc"]})
        exports = {}
        for p in src:
            f = self.files[p]
            if f["lang"] == "js":
                n = 0
                for m in JS_EXPORT_RE.finditer(f["code"]):
                    n += count_params(m.group(1)) if m.group(1) is not None else 1
            else:
                n = len(PY_EXPORT_RE.findall(f["code"]))
            exports[p] = n
        exp_cut = max(15, percentile([v for v in exports.values() if v], 95))
        for p, n in exports.items():
            if n >= exp_cut:
                self.hit("overloaded-module.many-exports", p, detail=f"{n} exports")
        # functions
        funcs = []
        for p in src:
            f = self.files[p]
            fl = js_functions(f["bare"]) if f["lang"] == "js" else py_functions(f["bare"])
            for fn in fl:
                fn["path"] = p
            funcs.extend(fl)
            f["functions"] = len(fl)
        named = [fn for fn in funcs if fn["name"] != "<anonymous>"]
        len_cut = max(30, percentile([fn["length"] for fn in funcs], 90))
        br_cut = max(8, percentile([fn["branches"] for fn in funcs], 90))
        self.func_stats = {
            "count": len(funcs),
            "length_p50": percentile([fn["length"] for fn in funcs], 50),
            "length_p90": percentile([fn["length"] for fn in funcs], 90),
            "branches_p90": percentile([fn["branches"] for fn in funcs], 90),
            "brain_cut": {"length": len_cut, "branches": br_cut, "nest": 3},
        }
        brains = []
        for fn in funcs:
            where = (fn["path"], fn["start"])
            label = f"{fn['name']}, {fn['length']} lines, {fn['branches']} branches, nest {fn['nest']}"
            if fn["length"] >= len_cut and fn["branches"] >= br_cut and fn["nest"] >= 3:
                self.hit("tangled-function.brain-function", *where, detail=label)
                brains.append({"path": fn["path"], "line": fn["start"], "name": fn["name"], "length": fn["length"],
                               "branches": fn["branches"], "nest": fn["nest"]})
            if fn["nest"] >= 4:
                self.hit("tangled-function.deep-nesting", *where, detail=f"{fn['name']}, nest {fn['nest']}")
            if fn["params"] >= 5:
                self.hit("tangled-function.many-params", *where, detail=f"{fn['name']}, {fn['params']} params")
            if fn["pass_through"]:
                self.hit("shallow-modules.pass-through", *where, detail=fn["name"])
            if fn["query_writes"]:
                self.hit("misleading-interface.query-name-writes", *where, detail=fn["name"])
        self.items["tangled-function.brain-function"] = sorted(brains, key=lambda b: -b["length"] * b["branches"])
        # duplicate top-level names across modules
        defs = defaultdict(set)
        for fn in named:
            if fn["top"] and len(fn["name"]) >= 4 and fn["name"] not in NAME_STOPLIST and not fn["name"].endswith(" callback"):
                defs[fn["name"]].add((fn["path"], fn["start"]))
        for name, sites in defs.items():
            mods = {self.files[p]["module"] for p, _ in sites}
            if len(sites) >= 2 and len(mods) >= 2:
                self.items["reinvented-logic.duplicate-name"].append(
                    {"name": name, "sites": sorted(f"{p}:{l}" for p, l in sites)})
                for p, l in sites:
                    self.hit("reinvented-logic.duplicate-name", p, line=l, detail=name)
        # fragmented modules
        by_mod = defaultdict(list)
        for p in src:
            by_mod[self.files[p]["module"]].append(self.files[p]["loc"])
        for mod, locs in by_mod.items():
            if len(locs) >= 6 and percentile(locs, 50) < 20:
                h = self.hits[mod]["shallow-modules.fragmented-module"]
                if self.scope is None or any(self.files[p]["module"] == mod for p in self.scope if p in self.files):
                    h["count"] += 1
                    h["examples"].append(f"{mod} ({len(locs)} files, median {percentile(locs, 50)} lines)")
        # mixed error idioms per module
        throws, results = Counter(), Counter()
        first = {}
        for p in src:
            f = self.files[p]
            t = len(THROW_RE[f["lang"]].findall(f["code"]))
            r = len(RESULT_ERR_RE[f["lang"]].findall(f["code"]))
            throws[f["module"]] += t
            results[f["module"]] += r
            if r:
                first.setdefault(f["module"], p)
        for mod in results:
            if throws[mod] >= 2 and results[mod] >= 2:
                self.hit("inconsistent-solutions.mixed-error-idioms", first[mod],
                         detail=f"{throws[mod]} throws, {results[mod]} error returns")
        # comment density
        ratios = {p: self.files[p]["comment_lines"] / max(1, self.files[p]["loc"]) for p in src if self.files[p]["loc"] >= 40}
        dense_cut = max(0.25, percentile(list(ratios.values()), 90))
        for p, r in ratios.items():
            if r >= dense_cut:
                self.hit("narrating-comments.comment-dense-file", p, detail=f"{round(r * 100)}% comment lines")
        # repeated literals
        lit_files = defaultdict(set)
        for p in src:
            f = self.files[p]
            for line in f["code"].split("\n"):
                if IMPORT_LINE_RE.match(line) or CLASS_LIST_LINE_RE.search(line):
                    continue
                for m in STRING_LITERAL_RE.finditer(line):
                    s = m.group(2)
                    if (LITERAL_SHAPE_RE.match(s) and s not in LITERAL_STOPLIST
                            and not s.startswith(("./", "../", "@/", "http"))):
                        lit_files[s].add(p)
        rep = []
        for s, ps in lit_files.items():
            mods = {self.files[p]["module"] for p in ps}
            if len(ps) >= 3 and len(mods) >= 2:
                rep.append({"literal": s, "files": len(ps), "modules": len(mods), "paths": ps})
        rep.sort(key=lambda r: (-r["files"], r["literal"]))
        for r in rep[:MAX_REPEATED_LITERALS]:
            for p in r.pop("paths"):
                self.hit("scattered-knowledge.repeated-literal", p, detail=repr(r["literal"]))
        for r in rep:
            r.pop("paths", None)
        self.items["scattered-knowledge.repeated-literal"] = rep
        # clones
        self.clones(src, "reinvented-logic.literal-clone", min_occurrences=2, distinct_files=True)
        self.clones(tests, "bloated-test-setup.duplicate-setup", min_occurrences=3, distinct_files=False)
        # tests
        mocks = {}
        self.test_stats = {"files": len(tests), "cases": 0, "assertions": 0, "mocks": 0, "assertion_free_files": 0}
        for p in tests:
            f = self.files[p]
            cases = len(TEST_CASE_RE[f["lang"]].findall(f["code"]))
            asserts = len(ASSERT_RE[f["lang"]].findall(f["code"]))
            mk = len(MOCK_RE[f["lang"]].findall(f["code"]))
            self.test_stats["cases"] += cases
            self.test_stats["assertions"] += asserts
            self.test_stats["mocks"] += mk
            mocks[p] = mk
            if cases and not asserts:
                self.test_stats["assertion_free_files"] += 1
                self.hit("toothless-tests.assertion-free-file", p, detail=f"{cases} cases, 0 assertions")
        mock_cut = max(5, percentile([v for v in mocks.values() if v], 90))
        for p, n in mocks.items():
            if n >= mock_cut:
                self.hit("implementation-coupled-tests.mock-heavy-file", p, detail=f"{n} mocks")

    def clones(self, paths, key, min_occurrences, distinct_files, window=6):
        seen = defaultdict(list)
        for p in paths:
            norm = []
            for i, line in enumerate(self.files[p]["code"].split("\n"), 1):
                s = " ".join(line.split())
                if not s or TRIVIAL_LINE_RE.match(s) or IMPORT_LINE_RE.match(s):
                    continue
                norm.append((i, s))
            for k in range(len(norm) - window + 1):
                h = hash(tuple(s for _, s in norm[k:k + window]))
                seen[h].append((p, norm[k][0], norm[k + window - 1][0]))
        dup_lines = defaultdict(set)
        partner = defaultdict(Counter)
        for occ in seen.values():
            if len(occ) < min_occurrences:
                continue
            files = {p for p, _, _ in occ}
            if distinct_files and len(files) < 2:
                continue
            for p, a, b in occ:
                dup_lines[p].update(range(a, b + 1))
                for q in files - {p}:
                    partner[p][q] += 1
        out = []
        for p, ls in dup_lines.items():
            if len(ls) >= 12:
                other = partner[p].most_common(1)
                detail = f"{len(ls)} duplicated lines" + (f", most shared with {other[0][0]}" if other else "")
                self.hit(key, p, line=min(ls), detail=detail)
                out.append({"path": p, "duplicated_lines": len(ls), "shared_with": other[0][0] if other else None})
        self.items[key] = sorted(out, key=lambda o: -o["duplicated_lines"])

    def run_dependencies(self):
        manifests = [p for p in self.all_paths if is_manifest(p)]
        self.deps = {p: parse_deps_text(p.rpartition("/")[2], (self.root / p).read_text(errors="replace")) for p in manifests}
        members = defaultdict(lambda: defaultdict(set))
        for m, deps in self.deps.items():
            for d in deps:
                fam = FAMILY_OF.get(d)
                if fam:
                    members[fam][d].add(m)
        src = self.source_files()
        if members.get("http-client"):
            users = [p for p in src if self.files[p]["lang"] == "js" and re.search(r"(?<![\w.])fetch\s*\(", self.files[p]["code"])]
            if users:
                members["http-client"]["fetch (built-in)"].update(users[:3])
        if members.get("logging"):
            users = [p for p in src if self.files[p]["lang"] == "js" and re.search(r"\bconsole\.(?:log|info|warn|error|debug)\s*\(", self.files[p]["code"])]
            if len(users) >= 3:
                members["logging"]["console"].update(users[:3])
        fams = []
        for fam, libs in members.items():
            if len(libs) >= 2:
                fams.append({"family": fam, "libs": {lib: sorted(where) for lib, where in sorted(libs.items())}})
                for lib, where in libs.items():
                    for w in where:
                        self.hit("inconsistent-solutions.dependency-family", w, detail=f"{fam}: {lib}")
        self.items["inconsistent-solutions.dependency-family"] = fams
        self.tooling = detect_tooling(self.root, self.all_paths, self.deps)

    def run_git(self):
        hist = git_history(self.root, self.window_days)
        self.pace = None
        if not hist:
            return
        commits, added = hist
        if not commits:
            self.pace = {"window_days": self.window_days, "commits": 0}
            return
        now = time.time()
        span_days = max(1.0, (now - min(c["ts"] for c in commits)) / 86400)
        weeks = max(1.0, min(span_days, self.window_days) / 7)
        churn = Counter()
        recent = defaultdict(float)
        lines = Counter()
        pairs = Counter()
        for c in commits:
            paths = [p for p, _, _ in c["files"]]
            weight = 0.5 ** ((now - c["ts"]) / 86400 / HOTSPOT_HALF_LIFE_DAYS)
            for p, a, d in c["files"]:
                churn[p] += 1
                recent[p] += weight
                lines[p] += a + d
            if len(paths) > SWEEP_MAX_FILES or SWEEP_MSG_RE.search(c["subject"]):
                continue
            src = sorted({p for p in paths if p in self.files and self.files[p]["lang"] and not self.files[p]["test"]})
            if len(src) > CO_CHANGE_MAX_SOURCE_FILES:
                continue
            for i in range(len(src)):
                for j in range(i + 1, len(src)):
                    if self.files[src[i]]["module"] != self.files[src[j]]["module"]:
                        pairs[(src[i], src[j])] += 1
        authors = Counter(c["author"] for c in commits)
        agent = sum(1 for c in commits if c["agent"])
        new_files = [p for p in added if p in self.files]
        self.pace = {
            "window_days": self.window_days,
            "history_days": round(span_days),
            "commits": len(commits),
            "commits_per_week": round(len(commits) / weeks, 1),
            "authors": len(authors),
            "agent_commit_share": round(agent / len(commits), 2),
            "files_added_30d": len(new_files),
            "median_files_per_commit": percentile([len(c["files"]) for c in commits], 50),
        }
        hot = []
        for p, n in churn.items():
            f = self.files.get(p)
            if f and f["lang"] and not f["test"] and n >= 3:
                hot.append({"path": p, "commits": n, "recent_commits": round(recent[p], 1), "loc": f["loc"],
                            "lines_changed": lines[p], "score": round(recent[p] * f["loc"])})
        hot.sort(key=lambda h: -h["score"])
        self.items["overloaded-module.hotspot"] = hot[:TOP]
        for h in hot[:10]:
            self.hit("overloaded-module.hotspot", h["path"], detail=f"{h['commits']} commits, {h['loc']} lines")
        co = [{"a": a, "b": b, "count": n} for (a, b), n in pairs.items() if n >= self.co_change_min]
        co.sort(key=lambda x: -x["count"])
        self.items["scattered-knowledge.co-change"] = co
        for x in co:
            if self.in_scope(x["a"]) or self.in_scope(x["b"]):
                for p, q in ((x["a"], x["b"]), (x["b"], x["a"])):
                    h = self.hits[self.files[p]["module"]]["scattered-knowledge.co-change"]
                    h["count"] += 1
                    if len(h["examples"]) < EXAMPLES_PER_SIGNAL:
                        h["examples"].append(f"{p} <-> {q} ({x['count']} commits)")

    def run_diff(self):
        base = self.diff_base
        mb = (git(self.root, "merge-base", base, "HEAD") or "").strip()
        if not mb:
            sys.exit(f"recon: cannot find merge base of {base} and HEAD")
        status = git(self.root, "diff", "--name-status", "-M", mb) or ""
        changed = {}
        for line in status.splitlines():
            cols = line.split("\t")
            if len(cols) >= 2:
                changed[cols[-1]] = cols[0][0]
        for p in (git(self.root, "ls-files", "--others", "--exclude-standard") or "").splitlines():
            changed.setdefault(p, "A")
        self.scope = {p for p, s in changed.items() if s != "D"}
        numstat = git(self.root, "diff", "--numstat", "-M", mb) or ""
        added = removed = 0
        for line in numstat.splitlines():
            cols = line.split("\t")
            if len(cols) == 3:
                added += int(cols[0]) if cols[0].isdigit() else 0
                removed += int(cols[1]) if cols[1].isdigit() else 0
        skip = self.signals["cards"]["toothless-tests"]["signals"]["skip-marker"]["patterns"]
        skip_re = {k: re.compile(v) for k, v in skip.items()}
        skips_added = 0
        cur = None
        for line in (git(self.root, "diff", "-U0", mb) or "").splitlines():
            if line.startswith("+++ "):
                cur = line[6:] if line.startswith("+++ b/") else None
            elif line.startswith("+") and cur and TEST_PATH_RE.search(cur):
                lang = LANG_BY_EXT.get(os.path.splitext(cur)[1].lower())
                if lang in skip_re and skip_re[lang].search(line[1:]):
                    skips_added += 1
        new_deps = []
        for p, s in changed.items():
            if not is_manifest(p) or s == "D":
                continue
            name = p.rpartition("/")[2]
            head = parse_deps_text(name, (self.root / p).read_text(errors="replace")) if (self.root / p).exists() else set()
            old = parse_deps_text(name, git(self.root, "show", f"{mb}:{p}") or "") if s != "A" else set()
            for d in sorted(head - old):
                fam = FAMILY_OF.get(d)
                existing = sorted(x for x in old if fam and FAMILY_OF.get(x) == fam)
                new_deps.append({"manifest": p, "dependency": d, "family": fam, "already_have": existing})
        mods = {self.module(p) for p in self.scope}
        self.change = {
            "base": base, "merge_base": mb[:12],
            "files_changed": len(changed), "lines_added": added, "lines_removed": removed,
            "modules_touched": len(mods),
            "test_files_modified": sorted(p for p, s in changed.items() if s == "M" and TEST_PATH_RE.search(p)),
            "skip_markers_added": skips_added,
            "new_dependencies": new_deps,
            "mixed_purpose_hint": len(mods) >= 4 or len(changed) >= 30,
        }

    # -- routing
    def route(self, budget):
        cards = self.signals["cards"]

        def strength(card, hits):
            total = 0.0
            for name, s in cards[card]["signals"].items():
                h = hits.get(f"{card}.{name}")
                if h and h["count"] >= s.get("min", 1):
                    total += s.get("weight", 1) * (1 + math.log2(h["count"]))
            return round(total, 2)

        modules = []
        for mod, hits in self.hits.items():
            local = {c: strength(c, hits) for c, cd in cards.items() if cd["scope"] == "local"}
            local = {c: v for c, v in local.items() if v > 0}
            ranked = sorted(local, key=lambda c: -local[c])
            mfiles = [p for p, f in self.files.items() if f["module"] == mod and f["lang"] and self.in_scope(p)]
            modules.append({
                "id": mod,
                "files": len(mfiles),
                "loc": sum(self.files[p]["loc"] for p in mfiles),
                "suggested_cards": ranked[:budget],
                "deferred_cards": ranked[budget:],
                "card_strength": {c: local[c] for c in ranked},
                "signals": {k: dict(v) for k, v in sorted(hits.items()) if v["count"]},
            })
        modules.sort(key=lambda m: -sum(m["card_strength"].values()))
        cross = []
        for card, cd in cards.items():
            if cd["scope"] != "cross":
                continue
            agg = defaultdict(lambda: {"count": 0})
            tops = Counter()
            for mod, hits in self.hits.items():
                for name in cd["signals"]:
                    h = hits.get(f"{card}.{name}")
                    if h and h["count"]:
                        agg[f"{card}.{name}"]["count"] += h["count"]
                        tops[mod] += h["count"]
            pending = [f"{card}.{n}" for n, s in cd["signals"].items() if s["kind"] in ("map", "model", "probe")]
            cross.append({"card": card, "family": cd["family"], "strength": strength(card, agg),
                          "signal_counts": {k: v["count"] for k, v in sorted(agg.items())},
                          "top_modules": [m for m, _ in tops.most_common(5)], "pending_signals": pending})
        cross.sort(key=lambda c: -c["strength"])
        # work units: greedy pack modules with suggestions into fan-out bins
        total_loc = sum(f["loc"] for f in self.files.values() if f["lang"] and not f["test"])
        scope_loc = sum(f["loc"] for p, f in self.files.items() if f["lang"] and not f["test"] and self.in_scope(p))
        size_class = next(name for cut, name, _ in SIZE_CLASSES if total_loc < cut)
        fanout = next(n for cut, _, n in SIZE_CLASSES if scope_loc < cut)
        active = [m for m in modules if m["suggested_cards"]]
        routed = {m["id"] for m in active}
        quiet = Counter()
        for p, f in self.files.items():
            if f["lang"] and self.in_scope(p) and f["module"] not in routed:
                quiet[f["module"]] += f["loc"]
        n_units = max(1, min(fanout, len(active) or 1))
        units = [{"modules": [], "unrouted": [], "loc": 0, "strength": Counter()} for _ in range(n_units)]
        for m in sorted(active, key=lambda m: -m["loc"]):
            u = min(units, key=lambda u: u["loc"])
            u["modules"].append(m["id"])
            u["loc"] += m["loc"]
            for c, v in m["card_strength"].items():
                u["strength"][c] += v
        for mod, loc in sorted(quiet.items(), key=lambda kv: -kv[1]):
            u = min(units, key=lambda u: u["loc"])
            u["unrouted"].append(mod)
            u["loc"] += loc
        work_units = []
        for i, u in enumerate(u for u in units if u["modules"] or u["unrouted"]):
            ranked = [c for c, _ in u["strength"].most_common()]
            chosen = ranked[:budget]
            by_bundle = defaultdict(list)
            for c in chosen:
                by_bundle[cards[c]["bundle"]].append(c)
            work_units.append({"id": f"unit-{i + 1}", "modules": u["modules"], "unrouted_modules": u["unrouted"],
                               "loc": u["loc"], "cards_by_bundle": dict(by_bundle), "deferred_cards": ranked[budget:]})
        return modules, cross, work_units, size_class, fanout, total_loc

    def build(self, budget):
        t0 = time.time()
        self.collect()
        self.split_large_modules()
        if self.diff_base:
            self.run_diff()
        self.run_text_signals()
        self.run_metrics()
        self.run_dependencies()
        self.run_git()
        modules, cross, units, size_class, fanout, total_loc = self.route(budget)
        langs = Counter()
        for f in self.files.values():
            langs[f["display"]] += f["loc"]
        src = self.source_files()
        locs = [self.files[p]["loc"] for p in src]
        test_loc = sum(self.files[p]["loc"] for p in self.test_files())
        return {
            "version": 1,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "elapsed_s": round(time.time() - t0, 2),
            "repo": {
                "root": str(self.root),
                "head": (git(self.root, "rev-parse", "--short", "HEAD") or "").strip() or None,
                "scope": "diff" if self.diff_base else "repo",
                "size_class": size_class, "suggested_fanout": fanout,
                "source_loc": total_loc, "test_loc": test_loc,
                "source_files": len(src), "test_files": len(self.test_files()),
                "modules": len({self.files[p]["module"] for p in src}),
                "package_roots": [r or "." for r in sorted(self.roots)],
                "languages": dict(langs.most_common()),
                "excluded": dict(self.excluded),
                "scaffolds": self.scaffolds,
            },
            "size": {
                "file_loc": {"p50": percentile(locs, 50), "p90": percentile(locs, 90),
                             "p99": percentile(locs, 99), "max": max(locs or [0])},
                "functions": self.func_stats,
            },
            "pace": self.pace,
            "tests": dict(self.test_stats, test_to_source_files=round(len(self.test_files()) / max(1, len(src)), 2)),
            "tooling": self.tooling,
            "change": getattr(self, "change", None),
            "cross_module_cards": cross,
            "work_units": units,
            "modules": modules,
            "evidence": {k: v[:50] for k, v in sorted(self.items.items()) if v},
        }


# ---------------------------------------------------------------- map

JS_RESOLVE_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
JS_IMPORT_RE = re.compile(
    r"^[ \t]*import[ \t]+(type[ \t]+)?((?:[\w$]+[ \t]*,?[ \t]*)?(?:\{[^}]*\}|\*[ \t]*as[ \t]+[\w$]+)?)"
    r"[ \t\n]*from[ \t]*['\"]([^'\"\n]+)['\"]", re.M)
JS_SIDE_IMPORT_RE = re.compile(r"^[ \t]*import[ \t]*['\"]([^'\"\n]+)['\"]", re.M)
JS_REEXPORT_RE = re.compile(
    r"^[ \t]*export[ \t]+(type[ \t]+)?(\{[^}]*\}|\*(?:[ \t]*as[ \t]+[\w$]+)?)[ \t]*from[ \t]*['\"]([^'\"\n]+)['\"]", re.M)
JS_REQUIRE_RE = re.compile(r"\b(?:require|import)\(\s*['\"]([^'\"\n]+)['\"]\s*\)")
JS_EXPORT_DECL_RE = re.compile(
    r"^[ \t]*export[ \t]+(default[ \t]+)?(?:declare[ \t]+)?(?:async[ \t]+)?"
    r"(function\*?|const|let|var|class|abstract[ \t]+class|type|interface|enum)[ \t]+([\w$]+)", re.M)
JS_EXPORT_DEFAULT_RE = re.compile(r"^[ \t]*export[ \t]+default[ \t]+(?!(?:async[ \t]+)?function|class|abstract)", re.M)
JS_EXPORT_LIST_RE = re.compile(r"^[ \t]*export[ \t]+(type[ \t]+)?\{([^}]*)\}[ \t]*;?[ \t]*$", re.M)
JS_CJS_RE = re.compile(r"^[ \t]*(?:module\.)?exports\.([\w$]+)[ \t]*=|^[ \t]*module\.exports[ \t]*=", re.M)
JS_CLASS_RE = re.compile(
    r"^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(abstract[ \t]+)?class[ \t]+([\w$]+)(?:<[^>{]*>)?"
    r"(?:[ \t]+extends[ \t]+([\w$.]+)(?:<[^>{]*>)?)?(?:[ \t]+implements[ \t]+([^{]+))?[ \t]*\{", re.M)
JS_INTERFACE_RE = re.compile(r"^[ \t]*(?:export[ \t]+)?interface[ \t]+([\w$]+)", re.M)
PY_IMPORT_RE = re.compile(r"^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)", re.M)
PY_FROM_RE = re.compile(r"^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)", re.M)
PY_TOPLEVEL_RE = re.compile(r"^(?:async[ \t]+)?def[ \t]+([A-Za-z]\w*)|^class[ \t]+([A-Za-z]\w*)|^([A-Z][A-Z0-9_]+)[ \t]*(?::[^=\n]+)?=", re.M)
PY_ALL_RE = re.compile(r"^__all__[ \t]*=[ \t]*[\[(]([^\])]*)[\])]", re.M)
PY_CLASS_RE = re.compile(r"^[ \t]*class[ \t]+(\w+)[ \t]*(?:\(([^)]*)\))?[ \t]*:", re.M)
NODE_BUILTINS = {
    "fs", "path", "os", "crypto", "child_process", "http", "https", "http2", "url", "util", "stream", "events",
    "buffer", "zlib", "net", "tls", "assert", "readline", "process", "timers", "worker_threads", "perf_hooks",
    "dns", "querystring", "module", "vm", "v8", "cluster", "async_hooks", "string_decoder", "tty", "dgram",
    "inspector", "test",
}
PY_STDLIB = set(getattr(sys, "stdlib_module_names", ())) or {
    "abc", "argparse", "asyncio", "base64", "collections", "contextlib", "copy", "csv", "dataclasses", "datetime",
    "decimal", "enum", "functools", "glob", "hashlib", "hmac", "html", "http", "importlib", "inspect", "io",
    "itertools", "json", "logging", "math", "os", "pathlib", "pickle", "platform", "queue", "random", "re",
    "shutil", "signal", "socket", "sqlite3", "ssl", "statistics", "string", "struct", "subprocess", "sys",
    "tempfile", "textwrap", "threading", "time", "traceback", "types", "typing", "unittest", "urllib", "uuid",
    "warnings", "weakref", "xml", "zipfile", "__future__",
}
NEXT_ENTRY_RE = re.compile(
    r"(^|/)(app|pages)/(.*/)?(page|layout|route|loading|error|not-found|template|default|global-error|"
    r"opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[cm]?[jt]sx?$|(^|/)pages/"
    r"|(^|/)(middleware|instrumentation(-client)?)\.[cm]?[jt]s$")
ENTRY_NAME_RE = re.compile(r"(^|/)[^/]*\.config\.[cm]?[jt]s$|(^|/)(__main__|manage|setup|conftest|wsgi|asgi)\.py$")
ENTRY_DIR_RE = re.compile(r"^(scripts|bin|cli|tools)/[^/]+$|(^|/)(public|static)/")
PATH_TOKEN_RE = re.compile(r"[\w@.\-/]+\.(?:[cm]?[jt]sx?|py)\b")
ENTRY_SOURCES_RE = re.compile(
    r"(^|/)(package\.json|render\.yaml|Dockerfile[^/]*|Procfile|docker-compose[^/]*\.ya?ml|pyproject\.toml|"
    r"Makefile|vercel\.json|netlify\.toml|tsup\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|[^/]+\.html)$|^\.github/workflows/")


def loose_json(text):
    """JSON with comments and trailing commas (tsconfig.json)."""
    text = strip_code(text, "js")[0]
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    try:
        return json.loads(text)
    except ValueError:
        return None


def split_names(clause):
    """'{ a, type b, c as d }' -> [(exported_or_imported_name, local_alias, type_only)]."""
    out = []
    for part in clause.strip().strip("{}").split(","):
        part = part.strip()
        if not part:
            continue
        type_only = part.startswith("type ")
        if type_only:
            part = part[5:].strip()
        bits = re.split(r"\s+as\s+", part)
        out.append((bits[0].strip(), bits[-1].strip(), type_only))
    return out


def first_doc_line(raw_lines, line_no, lang):
    """First line of the JSDoc above (js) or the docstring below (py) a declaration at line_no (1-based)."""
    if lang == "js":
        i = line_no - 2
        if i < 0 or not raw_lines[i].strip().endswith("*/"):
            return ""
        j = i
        while j >= 0 and "/**" not in raw_lines[j]:
            j -= 1
        for l in raw_lines[max(j, 0):i + 1]:
            t = l.strip().lstrip("/*").rstrip("*/").strip()
            if t and not t.startswith("@"):
                return t[:160]
        return ""
    for l in raw_lines[line_no:line_no + 4]:
        t = l.strip()
        if t.startswith(('"""', "'''", 'r"""')):
            t = t.lstrip("r").strip("\"'").strip()
            return t[:160]
        if t and not t.endswith((":", ",", "(")):
            return ""
    return ""


class ModuleMap:
    def __init__(self, prof):
        self.p = prof
        self.root = prof.root
        self.files = {path: f for path, f in prof.files.items() if f["lang"]}
        self.signals = prof.signals
        self.hits = defaultdict(lambda: defaultdict(lambda: {"count": 0, "examples": []}))
        self.items = defaultdict(list)

    def hit(self, key, path, line=None, detail=None, module=None):
        if module is None and not self.p.in_scope(path):
            return
        h = self.hits[module or self.files[path]["module"]][key]
        h["count"] += 1
        if len(h["examples"]) < EXAMPLES_PER_SIGNAL:
            h["examples"].append((f"{path}:{line}" if line else path) + (f" ({detail})" if detail else ""))

    # -- resolution
    def load_tsconfigs(self):
        self.tsconfigs = []
        for p in self.p.all_paths:
            name = p.rpartition("/")[2]
            if name == "tsconfig.json" or re.match(r"tsconfig\.[\w-]+\.json$", name):
                j = loose_json((self.root / p).read_text(errors="replace")) or {}
                co = j.get("compilerOptions") or {}
                d = p.rpartition("/")[0]
                base = os.path.normpath(os.path.join(d, co.get("baseUrl", "."))) if (co.get("baseUrl") or co.get("paths")) else None
                self.tsconfigs.append((d, base, co.get("paths") or {}))
        self.tsconfigs.sort(key=lambda t: -len(t[0]))

    def try_file(self, base):
        base = base.replace("\\", "/")
        if base.startswith("./"):
            base = base[2:]
        cands = [base]
        stem, ext = os.path.splitext(base)
        if ext in (".js", ".jsx", ".mjs", ".cjs"):
            cands += [stem + e for e in JS_RESOLVE_EXTS]
        cands += [base + e for e in JS_RESOLVE_EXTS] + [base + "/index" + e for e in JS_RESOLVE_EXTS]
        for c in cands:
            if c in self.files:
                return c
        return None

    def resolve_js(self, spec, src):
        d = src.rpartition("/")[0]
        if spec.startswith("."):
            return self.try_file(os.path.normpath(os.path.join(d, spec))), None
        for tdir, base, paths in self.tsconfigs:
            if tdir and not (src == tdir or src.startswith(tdir + "/")):
                continue
            for pat, targets in paths.items():
                if pat.endswith("*") and spec.startswith(pat[:-1]):
                    rest = spec[len(pat) - 1:]
                elif pat == spec:
                    rest = ""
                else:
                    continue
                for t in targets:
                    hit = self.try_file(os.path.normpath(os.path.join(base or tdir, t.replace("*", rest))))
                    if hit:
                        return hit, None
            if base:
                hit = self.try_file(os.path.normpath(os.path.join(base, spec)))
                if hit:
                    return hit, None
        if spec.startswith("node:") or spec.split("/")[0] in NODE_BUILTINS:
            return None, None
        parts = spec.split("/")
        return None, "/".join(parts[:2]) if spec.startswith("@") else parts[0]

    def build_py_index(self):
        roots = sorted({r for r in self.p.roots} | {r + "/src" if r else "src" for r in self.p.roots}, key=len, reverse=True)
        self.py_index, self.py_dotted = {}, {}
        for path, f in self.files.items():
            if f["lang"] != "py":
                continue
            for r in roots:
                if r and not path.startswith(r + "/"):
                    continue
                rel = path[len(r) + 1:] if r else path
                dotted = rel[:-3].replace("/", ".")
                if dotted == "__init__":
                    dotted = ""
                elif dotted.endswith(".__init__"):
                    dotted = dotted[:-9]
                self.py_index.setdefault(dotted, path)
                self.py_dotted.setdefault(path, dotted)

    def resolve_py(self, dotted, src, level):
        if level:
            own = self.py_dotted.get(src, "")
            pkg = own if src.endswith("__init__.py") else own.rpartition(".")[0]
            parts = pkg.split(".") if pkg else []
            parts = parts[:len(parts) - (level - 1)] if level > 1 else parts
            full = ".".join(parts + ([dotted] if dotted else []))
            return self.py_index.get(full), None
        if dotted in self.py_index:
            return self.py_index[dotted], None
        top = dotted.split(".")[0]
        return None, (None if top in PY_STDLIB else top)

    # -- parse
    def parse(self):
        self.load_tsconfigs()
        self.build_py_index()
        self.edges = []  # (src, dst, names, star, type_only)
        self.reexports = defaultdict(list)  # file -> [(target, {exported: orig} | "*")]
        self.exports = {}  # file -> {name: {...}}
        self.external = defaultdict(set)
        self.classes = []  # (path, name, kind, parents, is_abstract)
        for path, f in self.files.items():
            code, raw_lines = f["code"], f["text"].split("\n")
            ln = Lines(code)
            ex = {}
            if f["lang"] == "js":
                for m in JS_IMPORT_RE.finditer(code):
                    tgt, ext = self.resolve_js(m.group(3), path)
                    clause = m.group(2)
                    names, star = [], "* as" in clause or re.search(r"\*\s*as", clause) is not None
                    default = re.match(r"\s*([\w$]+)", clause)
                    if default and not clause.strip().startswith("{"):
                        names.append(("default", False))
                    brace = re.search(r"\{[^}]*\}", clause)
                    type_all = bool(m.group(1))
                    if brace:
                        names += [(n, t or type_all) for n, _, t in split_names(brace.group(0))]
                    if tgt:
                        self.edges.append((path, tgt, [n for n, _ in names], star,
                                           type_all or (names and all(t for _, t in names) and not star)))
                    elif ext:
                        self.external[path].add(ext)
                for m in JS_SIDE_IMPORT_RE.finditer(code):
                    tgt, ext = self.resolve_js(m.group(1), path)
                    if tgt:
                        self.edges.append((path, tgt, [], False, False))
                    elif ext:
                        self.external[path].add(ext)
                for m in JS_REQUIRE_RE.finditer(code):
                    tgt, ext = self.resolve_js(m.group(1), path)
                    if tgt:
                        self.edges.append((path, tgt, [], True, False))
                    elif ext:
                        self.external[path].add(ext)
                for m in JS_REEXPORT_RE.finditer(code):
                    tgt, ext = self.resolve_js(m.group(3), path)
                    if not tgt:
                        if ext:
                            self.external[path].add(ext)
                        continue
                    if m.group(2).startswith("*"):
                        alias = re.search(r"as\s+([\w$]+)", m.group(2))
                        if alias:
                            ex[alias.group(1)] = {"kind": "namespace", "line": ln.line(m.start()), "reexport": True}
                            self.reexports[path].append((tgt, {alias.group(1): "*"}))
                        else:
                            self.reexports[path].append((tgt, "*"))
                    else:
                        mapping = {alias: orig for orig, alias, _ in split_names(m.group(2))}
                        self.reexports[path].append((tgt, mapping))
                        for alias in mapping:
                            ex[alias] = {"kind": "reexport", "line": ln.line(m.start()), "reexport": True}
                    self.edges.append((path, tgt, [], False, bool(m.group(1))))
                for m in JS_EXPORT_DECL_RE.finditer(code):
                    kind = m.group(2).split()[-1].rstrip("*")
                    name = "default" if m.group(1) else m.group(3)
                    line = ln.line(m.start())
                    ex[name] = {"kind": kind, "line": line, "local": m.group(3),
                                "type_only": kind in ("type", "interface"),
                                "signature": raw_lines[line - 1].strip()[:160],
                                "doc": first_doc_line(raw_lines, line, "js")}
                for m in JS_EXPORT_DEFAULT_RE.finditer(code):
                    line = ln.line(m.start())
                    ex.setdefault("default", {"kind": "default", "line": line, "signature": raw_lines[line - 1].strip()[:160],
                                              "doc": first_doc_line(raw_lines, line, "js")})
                for m in JS_EXPORT_LIST_RE.finditer(code):
                    line = ln.line(m.start())
                    for orig, alias, t in split_names(m.group(2)):
                        ex.setdefault(alias, {"kind": "binding", "line": line, "local": orig,
                                              "type_only": t or bool(m.group(1)), "signature": f"export {{ {orig} }}", "doc": ""})
                for m in JS_CJS_RE.finditer(code):
                    name = m.group(1) or "default"
                    ex.setdefault(name, {"kind": "commonjs", "line": ln.line(m.start()), "signature": raw_lines[ln.line(m.start()) - 1].strip()[:160], "doc": ""})
                for m in JS_CLASS_RE.finditer(code):
                    parents = []
                    if m.group(3):
                        parents.append(m.group(3).split(".")[-1])
                    if m.group(4):
                        parents += [re.sub(r"<.*", "", x).strip() for x in m.group(4).split(",") if x.strip()]
                    self.classes.append((path, m.group(2), "class", parents, bool(m.group(1))))
                for m in JS_INTERFACE_RE.finditer(code):
                    self.classes.append((path, m.group(1), "interface", [], True))
            else:
                for m in PY_IMPORT_RE.finditer(code):
                    for part in m.group(1).split(","):
                        dotted = part.strip().split()[0]
                        tgt, ext = self.resolve_py(dotted, path, 0)
                        if tgt:
                            self.edges.append((path, tgt, [], True, False))
                        elif ext:
                            self.external[path].add(ext)
                for m in PY_FROM_RE.finditer(code):
                    mod = m.group(1)
                    level = len(mod) - len(mod.lstrip("."))
                    dotted = mod.lstrip(".")
                    names = [n.strip().split()[0] for n in m.group(2).strip("() \n").split(",") if n.strip() and n.strip() != "*"]
                    star = m.group(2).strip() == "*"
                    tgt, ext = self.resolve_py(dotted, path, level)
                    if not tgt and not ext:
                        continue
                    if ext:
                        self.external[path].add(ext)
                        continue
                    sub = []
                    for n in names:
                        subtgt, _ = self.resolve_py((dotted + "." + n).strip("."), path, level)
                        if subtgt and subtgt != tgt:
                            self.edges.append((path, subtgt, [], True, False))
                        else:
                            sub.append(n)
                    if sub or star or not names:
                        self.edges.append((path, tgt, sub, star, False))
                all_m = PY_ALL_RE.search(code)
                allowed = set(re.findall(r"['\"](\w+)['\"]", f["text"][all_m.start():all_m.end()])) if all_m else None
                for m in PY_TOPLEVEL_RE.finditer(code):
                    name = m.group(1) or m.group(2) or m.group(3)
                    if allowed is not None and name not in allowed:
                        continue
                    line = ln.line(m.start())
                    kind = "function" if m.group(1) else "class" if m.group(2) else "constant"
                    ex[name] = {"kind": kind, "line": line, "signature": raw_lines[line - 1].strip()[:160],
                                "doc": first_doc_line(raw_lines, line, "py")}
                for m in PY_CLASS_RE.finditer(code):
                    bases = [b.strip().split(".")[-1] for b in (m.group(2) or "").split(",") if b.strip() and "=" not in b]
                    meta = "ABCMeta" in (m.group(2) or "")
                    abstract = meta or any(b in ("ABC", "Protocol") for b in bases)
                    kind = "interface" if "Protocol" in bases else "class"
                    self.classes.append((path, m.group(1), kind, bases, abstract))
            self.exports[path] = ex

    # -- analysis
    def entry_points(self):
        entries = set()
        for p, f in self.files.items():
            if f["test"] or NEXT_ENTRY_RE.search(p) or ENTRY_NAME_RE.search(p) or ENTRY_DIR_RE.match(p):
                entries.add(p)
            elif f["text"].startswith("#!") or (f["lang"] == "py" and "__name__" in f["text"] and "__main__" in f["text"]):
                entries.add(p)
        for p in self.p.all_paths:
            if not ENTRY_SOURCES_RE.search(p):
                continue
            text = (self.root / p).read_text(errors="replace")
            d = p.rpartition("/")[0]
            for tok in PATH_TOKEN_RE.findall(text):
                tok = tok.lstrip("./")
                for cand in {tok, os.path.normpath(os.path.join(d, tok)) if d else tok,
                             re.sub(r"^(dist|build|out|lib)/", "", tok)}:
                    hit = self.try_file(cand) or self.try_file(os.path.splitext(cand)[0])
                    if hit:
                        entries.add(hit)
        for pkg in [p for p in self.p.all_paths if p.rpartition("/")[2] == "package.json"]:
            j = read_json(self.root / pkg) or {}
            d = pkg.rpartition("/")[0]
            vals = []
            for k in ("main", "module", "types", "browser"):
                if isinstance(j.get(k), str):
                    vals.append(j[k])
            for k in ("bin", "exports"):
                v = j.get(k)
                stack = [v]
                while stack:
                    x = stack.pop()
                    if isinstance(x, str):
                        vals.append(x)
                    elif isinstance(x, dict):
                        stack.extend(x.values())
            for v in vals:
                v = re.sub(r"^\./", "", v)
                for cand in (os.path.join(d, v) if d else v, os.path.join(d, re.sub(r"^(dist|build|out|lib)/", "src/", v)) if d else re.sub(r"^(dist|build|out|lib)/", "src/", v)):
                    hit = self.try_file(cand) or self.try_file(os.path.splitext(cand)[0])
                    if hit:
                        entries.add(hit)
        for r in self.p.roots:
            for name in ("index", "main", "server", "app", "worker", "cli"):
                for e in JS_RESOLVE_EXTS + [".py"]:
                    c = (r + "/" if r else "") + name + e
                    if c in self.files:
                        entries.add(c)
        return entries

    def analyze(self):
        files = self.files
        entries = self.entry_points()
        self.entries = entries
        used_src, used_test = defaultdict(set), defaultdict(set)
        inbound = defaultdict(set)

        def mark(target, name, is_test, seen):
            if (target, name) in seen:
                return
            seen.add((target, name))
            (used_test if is_test else used_src)[target].add(name)
            local = self.exports.get(target, {})
            for tgt, mapping in self.reexports.get(target, []):
                if mapping == "*":
                    if name == "*" or name not in local:
                        mark(tgt, name, is_test, seen)
                elif name == "*":
                    for orig in mapping.values():
                        mark(tgt, orig, is_test, seen)
                elif name in mapping:
                    mark(tgt, mapping[name], is_test, seen)

        self.importers = defaultdict(set)
        for src, dst, names, star, _ in self.edges:
            inbound[dst].add(src)
            is_test = files[src]["test"]
            if not is_test:
                for n in (["*"] if star else []) + list(names):
                    self.importers[(dst, n)].add(src)
            if star or (not names and files[dst]["lang"] == "py"):
                mark(dst, "*", is_test, set())
            for n in names:
                mark(dst, n, is_test, set())
        for e in entries:
            if not files[e]["test"]:
                mark(e, "*", False, set())
        # dead exports, orphans, test-only exports
        dead, test_only, orphans = [], [], []
        for p, ex in self.exports.items():
            f = files[p]
            if f["test"] or p in entries:
                continue
            if not inbound[p] and not p.endswith("__init__.py"):
                orphans.append(p)
                self.hit("dead-code.orphan-file", p, detail=f"{f['loc']} lines, no importers")
                continue
            if "*" in used_src[p]:
                continue
            bare = f["bare"]
            for name, info in ex.items():
                if info.get("reexport") or name in used_src[p]:
                    continue
                local_name = info.get("local") or name
                local_uses = len(re.findall(r"(?<![\w$])" + re.escape(local_name) + r"(?![\w$])", bare)) if local_name != "default" else 1
                if name in used_test[p] or "*" in used_test[p]:
                    if local_uses <= 1:
                        test_only.append({"path": p, "line": info["line"], "name": name})
                        self.hit("speculative-generality.test-only-export", p, info["line"], name)
                    continue
                if local_uses <= 1:
                    dead.append({"path": p, "line": info["line"], "name": name, "kind": info["kind"]})
                    self.hit("dead-code.unimported-export", p, info["line"], f"{info['kind']} {name}")
        self.items["dead-code.unimported-export"] = dead
        self.items["dead-code.orphan-file"] = orphans
        self.items["speculative-generality.test-only-export"] = test_only
        # single implementations
        impls = defaultdict(lambda: {"src": [], "test": []})
        for path, name, kind, parents, _ in self.classes:
            for par in parents:
                impls[par]["test" if files[path]["test"] else "src"].append(f"{path}#{name}")
        singles = []
        for path, name, kind, parents, abstract in self.classes:
            if not abstract or files[path]["test"]:
                continue
            i = impls.get(name, {"src": [], "test": []})
            structural = kind == "interface"
            if i["test"] or len(i["src"]) > 1 or (structural and not i["src"]):
                continue
            detail = f"{name}: " + (f"only {i['src'][0]}" if i["src"] else "no implementations")
            singles.append({"path": path, "name": name, "implementations": i["src"]})
            self.hit("speculative-generality.single-implementation", path, detail=detail)
        self.items["speculative-generality.single-implementation"] = singles
        # module graph
        mod_of = {p: f["module"] for p, f in files.items()}
        out_edges, out_runtime = defaultdict(Counter), defaultdict(set)
        for src, dst, _, _, type_only in self.edges:
            a, b = mod_of[src], mod_of[dst]
            if a == b or files[src]["test"]:
                continue
            out_edges[a][b] += 1
            if not type_only:
                out_runtime[a].add(b)
        self.out_edges = out_edges
        modules = sorted({f["module"] for f in files.values()})
        fan_out = {m: len(out_edges[m]) for m in modules}
        fan_in = Counter()
        for a, bs in out_edges.items():
            for b in bs:
                fan_in[b] += 1
        cycles = [c for c in tarjan(modules, out_runtime) if len(c) > 1]
        cycles.sort(key=lambda c: -len(c))
        self.items["import-tangle.cycle"] = [{"modules": sorted(c), "size": len(c)} for c in cycles]
        for c in cycles:
            for m in c:
                self.hit("import-tangle.cycle", m, detail=f"cycle of {len(c)}: " + ", ".join(sorted(c)[:4]), module=m)
        src_mods = [m for m in modules if any(not f["test"] and f["module"] == m for f in files.values())]
        fi_cut = max(3, percentile([fan_in[m] for m in src_mods], 90))
        fo_cut = max(3, percentile([fan_out[m] for m in src_mods], 90))
        hubs = [m for m in src_mods if fan_in[m] >= fi_cut and fan_out[m] >= fo_cut]
        self.items["import-tangle.hub"] = [{"module": m, "fan_in": fan_in[m], "fan_out": fan_out[m]} for m in hubs]
        for m in hubs:
            self.hit("import-tangle.hub", m, detail=f"fan-in {fan_in[m]}, fan-out {fan_out[m]}", module=m)
        # interface depth
        depth = {}
        mod_exports, mod_loc = Counter(), Counter()
        for p, f in files.items():
            if f["test"]:
                continue
            mod_loc[f["module"]] += f["loc"]
            mod_exports[f["module"]] += sum(1 for i in self.exports.get(p, {}).values() if not i.get("reexport"))
        for m in src_mods:
            if mod_exports[m] >= 4:
                depth[m] = round(mod_loc[m] / mod_exports[m], 1)
        d_cut = min(15, percentile(list(depth.values()), 10)) if depth else 0
        shallow = [m for m, d in depth.items() if d <= d_cut]
        self.items["shallow-modules.shallow-interface"] = [{"module": m, "exports": mod_exports[m], "loc": mod_loc[m], "lines_per_export": depth[m]} for m in shallow]
        for m in shallow:
            self.hit("shallow-modules.shallow-interface", m, detail=f"{mod_exports[m]} exports over {mod_loc[m]} lines", module=m)
        self.modules = []
        for m in modules:
            mfiles = sorted(p for p, f in files.items() if f["module"] == m)
            ext = Counter()
            for p in mfiles:
                for e in self.external.get(p, ()):
                    ext[e] += 1
            self.modules.append({
                "id": m, "files": mfiles, "loc": sum(files[p]["loc"] for p in mfiles),
                "test": all(files[p]["test"] for p in mfiles),
                "exports": mod_exports[m], "lines_per_export": depth.get(m),
                "imports": sorted(out_edges[m]), "imported_by": sorted(a for a, bs in out_edges.items() if m in bs),
                "fan_in": fan_in[m], "fan_out": fan_out[m],
                "external": sorted(ext), "entry_files": [p for p in mfiles if p in entries],
                "signals": {k: dict(v) for k, v in sorted(self.hits.get(m, {}).items())},
            })

    def build(self):
        t0 = time.time()
        self.parse()
        self.analyze()
        ext_spread = Counter()
        for m in self.modules:
            if not m["test"]:
                for e in m["external"]:
                    ext_spread[e] += 1
        files_out = {}
        top_exports = []
        for p, f in sorted(self.files.items()):
            exports = []
            for n, i in sorted(self.exports.get(p, {}).items(), key=lambda kv: kv[1].get("line", 0)):
                e = dict(name=n, **{k: v for k, v in i.items() if k in ("kind", "line", "signature", "doc", "type_only")})
                e["importers"] = len(self.importers.get((p, n), set()) | self.importers.get((p, "*"), set()))
                exports.append(e)
                callable_ = i.get("kind") in ("function", "class", "default") or re.search(
                    r"=>|\bfunction\b|\(", i.get("signature") or "")
                if not f["test"] and not i.get("type_only") and not i.get("reexport") and callable_:
                    top_exports.append({"path": p, "name": n, "importers": e["importers"], "doc": e.get("doc", "")})
            files_out[p] = {
                "module": f["module"], "loc": f["loc"], "test": f["test"], "entry": p in self.entries,
                "exports": exports,
                "imports": sorted({dst for src, dst, _, _, _ in self.edges if src == p}),
                "external": sorted(self.external.get(p, ())),
            }
        return {
            "version": 1,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "elapsed_s": round(time.time() - t0, 2),
            "repo": {"root": str(self.root), "head": (git(self.root, "rev-parse", "--short", "HEAD") or "").strip() or None,
                     "scope": "diff" if self.p.diff_base else "repo"},
            "summary": {
                "modules": len(self.modules), "files": len(self.files),
                "internal_edges": len(self.edges), "entry_files": len(self.entries),
                "external_packages": len(ext_spread),
            },
            "external_spread": [{"package": k, "modules": v} for k, v in ext_spread.most_common(TOP)],
            "most_imported_exports": sorted(top_exports, key=lambda e: -e["importers"])[:TOP],
            "modules": self.modules,
            "files": files_out,
            "evidence": {k: v[:50] for k, v in sorted(self.items.items()) if v},
        }


def tarjan(nodes, edges):
    index, low, on, stack, out = {}, {}, set(), [], []
    counter = [0]
    for start in nodes:
        if start in index:
            continue
        work = [(start, iter(sorted(edges.get(start, ()))))]
        index[start] = low[start] = counter[0]
        counter[0] += 1
        stack.append(start)
        on.add(start)
        while work:
            v, it = work[-1]
            advanced = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter[0]
                    counter[0] += 1
                    stack.append(w)
                    on.add(w)
                    work.append((w, iter(sorted(edges.get(w, ())))))
                    advanced = True
                    break
                if w in on:
                    low[v] = min(low[v], index[w])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[v])
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                out.append(comp)
    return out


MAP_MD_HEAD = """# Module map

<!-- Written by recon.py map. The model pass fills `responsibility` (one line: what this module is for)
and `terms` (the domain nouns it owns) for every module, reading only the exports listed here.
Entries whose hash is unchanged keep their text when the map is regenerated. -->

"""


def write_map_md(mp, path):
    old = {}
    if path.exists():
        for sec in re.split(r"\n(?=## )", path.read_text()):
            m = re.match(r"## (\S+)\n<!-- hash: (\w+) -->\n- responsibility: (.*)\n- terms: (.*)\n", sec)
            if m:
                old[m.group(1)] = (m.group(2), m.group(3), m.group(4))
    out, todo = [MAP_MD_HEAD], 0
    for m in mp["modules"]:
        exports = [(p, e) for p in m["files"] for e in mp["files"][p]["exports"]]
        sig = "\n".join(sorted(f"{p}:{e.get('signature', e['name'])}" for p, e in exports) + m["files"])
        h = hashlib_sha1(sig)
        prev = old.get(m["id"])
        resp, terms = (prev[1], prev[2]) if prev and prev[0] == h else ("", "")
        if m["test"]:
            resp, terms = resp or "(tests)", terms or "-"
        if not resp:
            todo += 1
        out.append(f"## {m['id']}\n<!-- hash: {h} -->\n- responsibility: {resp}\n- terms: {terms}\n")
        if not m["test"] and not exports:
            out.append("- no exports: describe it from its file names, imports and entry files\n")
        if m["entry_files"]:
            out.append("- entry files: " + ", ".join(p.rpartition("/")[2] for p in m["entry_files"][:8]) + "\n")
        bits = [f"{len(m['files'])} files, {m['loc']} lines"]
        if m["test"]:
            bits.append("tests")
        if m["imports"]:
            bits.append("imports " + ", ".join(m["imports"][:8]) + (" ..." if len(m["imports"]) > 8 else ""))
        if m["imported_by"]:
            bits.append("imported by " + ", ".join(m["imported_by"][:8]) + (" ..." if len(m["imported_by"]) > 8 else ""))
        if m["external"]:
            bits.append("packages " + ", ".join(m["external"][:8]))
        out.append("- " + "; ".join(bits) + "\n")
        if not m["test"] and exports:
            out.append("- exports:\n")
            for p, e in exports[:30]:
                doc = f" — {e['doc']}" if e.get("doc") else ""
                out.append(f"  - `{p.rpartition('/')[2]}` `{e.get('signature') or e['name']}`{doc}\n")
            if len(exports) > 30:
                out.append(f"  - +{len(exports) - 30} more\n")
        out.append("\n")
    path.write_text("".join(out))
    return todo


def hashlib_sha1(s):
    import hashlib
    return hashlib.sha1(s.encode()).hexdigest()[:10]


MAP_FAMILY = {"shallow-modules": "abstraction", "speculative-generality": "abstraction", "misleading-interface": "abstraction",
              "import-tangle": "graph", "dead-code": "graph"}


def summarize_map(mp, out_dir, todo):
    s, ev = mp["summary"], mp["evidence"]
    w = [f"refactor map: {mp['repo']['root']} ({s['modules']} modules and {s['files']} files, tests included; "
         f"{s['internal_edges']} internal imports, {s['entry_files']} entry files, {s['external_packages']} external packages)"]
    cyc = ev.get("import-tangle.cycle", [])
    w.append(f"import cycles: {len(cyc)}" + (f"; largest: {', '.join(cyc[0]['modules'][:6])} ({cyc[0]['size']} modules)" if cyc else ""))
    hubs = ev.get("import-tangle.hub", [])
    if hubs:
        w.append("hub modules: " + ", ".join(f"{h['module']} (in {h['fan_in']}, out {h['fan_out']})" for h in hubs[:5]))
    dead = ev.get("dead-code.unimported-export", [])
    if dead:
        w.append(f"exports with no importers: {len(mp['evidence']['dead-code.unimported-export'])}+; e.g. "
                 + ", ".join(f"{d['path']}#{d['name']}" for d in dead[:4]))
    orph = ev.get("dead-code.orphan-file", [])
    if orph:
        w.append(f"files with no importers (not entry points): {len(orph)}; e.g. " + ", ".join(orph[:4]))
    to = ev.get("speculative-generality.test-only-export", [])
    if to:
        w.append(f"exports used only by tests: {len(to)}; e.g. " + ", ".join(f"{d['path']}#{d['name']}" for d in to[:4]))
    si = ev.get("speculative-generality.single-implementation", [])
    if si:
        w.append("abstractions with one implementation or none: " + ", ".join(f"{d['name']} ({d['path']})" for d in si[:5]))
    sh = ev.get("shallow-modules.shallow-interface", [])
    if sh:
        w.append("shallow interfaces: " + ", ".join(f"{d['module']} ({d['exports']} exports, {d['lines_per_export']} lines each)" for d in sh[:5]))
    if mp["external_spread"]:
        w.append("packages imported from the most modules: " + ", ".join(f"{e['package']} ({e['modules']})" for e in mp["external_spread"][:8]))
    if mp.get("most_imported_exports"):
        w.append("most-imported exports (start the call-site test here): " + ", ".join(
            f"{e['path'].rpartition('/')[2]}#{e['name']} ({e['importers']})" for e in mp["most_imported_exports"][:8]))
    fam = Counter()
    for key, items in ev.items():
        fam[MAP_FAMILY.get(key.split(".")[0], "other")] += len(items)
    w.append("map evidence by family: " + ", ".join(f"{f} {fam.get(f, 0)}" for f in ("abstraction", "graph"))
             + " (duplication evidence comes from the profile and the model pass)")
    w.append(f"wrote {out_dir / 'map.json'} and {out_dir / 'map.md'} ({todo} modules need a responsibility line)  ({mp['elapsed_s']}s)")
    print("\n".join(w))


# ---------------------------------------------------------------- summary

def fmt(n):
    return f"{n:,}"


def summarize(prof, out_path):
    r, s, pace, t, tool = prof["repo"], prof["size"], prof["pace"], prof["tests"], prof["tooling"]
    w = []
    w.append(f"refactor profile: {r['root']} ({r['scope']} scope, size {r['size_class']}: "
             f"{fmt(r['source_loc'])} source lines in {fmt(r['source_files'])} source files and {r['modules']} source modules; "
             f"{fmt(r['test_files'])} test files)")
    langs = " · ".join(f"{k} {fmt(v)}" for k, v in list(r["languages"].items())[:5])
    excl = ", ".join(f"{n} {why}" for why, n in r["excluded"].items())
    w.append(f"languages: {langs}" + (f"   excluded: {excl}" if excl else ""))
    if r.get("scaffolds"):
        w.append(f"skipped template/example packages: {', '.join(r['scaffolds'])} (not the project's own code)")
    if pace and pace.get("commits"):
        w.append(f"pace ({pace['window_days']}d): {fmt(pace['commits'])} commits ({pace['commits_per_week']}/week), "
                 f"{pace['authors']} authors, {round(pace['agent_commit_share'] * 100)}% agent-attributed "
                 f"(trailers and author names only), "
                 f"{pace['files_added_30d']} files added in 30d, history {pace['history_days']}d")
    elif pace:
        w.append(f"pace ({pace['window_days']}d): no commits in window")
    else:
        w.append("pace: no git history")
    fl, fn = s["file_loc"], s["functions"]
    brains = len(prof["evidence"].get("tangled-function.brain-function", []))
    w.append(f"size: file lines p50 {fl['p50']} · p90 {fl['p90']} · p99 {fl['p99']} · max {fl['max']}; "
             f"{fmt(fn['count'])} functions (p90 {fn['length_p90']} lines); {brains} brain functions")
    w.append(f"tests: {t['files']} test files ({t['test_to_source_files']} per source file), {fmt(t['cases'])} cases, "
             f"{fmt(t['assertions'])} assertions, {fmt(t['mocks'])} mocks, {t['assertion_free_files']} assertion-free files")
    cmds = []
    for pkg in tool["packages"][:3]:
        bits = [f"{k} `{pkg[k]}`" for k in ("test", "typecheck", "lint") if k in pkg]
        if bits:
            cmds.append(f"[{pkg['package']}] " + ", ".join(bits))
    if tool["python"]:
        cmds.append("[python] " + ", ".join(f"{k} `{v}`" for k, v in tool["python"].items()))
    w.append("tooling: " + ("; ".join(cmds) if cmds else "no test, lint or typecheck commands found"))
    if tool["unused_code"]:
        w.append("unused-code probes available: " + ", ".join(tool["unused_code"]))
    fams = prof["evidence"].get("inconsistent-solutions.dependency-family", [])
    if fams:
        w.append("dependency families with 2+ libraries: " + "; ".join(f"{f['family']} ({', '.join(f['libs'])})" for f in fams))
    co = prof["evidence"].get("scattered-knowledge.co-change", [])
    if co:
        w.append(f"co-change: {len(co)} cross-module file pairs; top: {co[0]['a']} <-> {co[0]['b']} ({co[0]['count']} commits)")
    hot = prof["evidence"].get("overloaded-module.hotspot", [])
    if hot:
        w.append("hotspots: " + ", ".join(f"{h['path']} ({h['commits']}x, {h['loc']} lines)" for h in hot[:3]))
    ch = prof.get("change")
    if ch:
        w.append(f"change vs {ch['base']}: {ch['files_changed']} files, +{ch['lines_added']} −{ch['lines_removed']}, "
                 f"{ch['modules_touched']} modules" + ("; MIXED-PURPOSE HINT" if ch["mixed_purpose_hint"] else ""))
        if ch["test_files_modified"]:
            w.append(f"  test files modified: {len(ch['test_files_modified'])}; skip markers added: {ch['skip_markers_added']}")
        for d in ch["new_dependencies"]:
            if d["already_have"]:
                w.append(f"  new dependency {d['dependency']} overlaps existing {', '.join(d['already_have'])} ({d['family']})")
    w.append("")
    w.append("cross-module cards (run once per family over the map):")
    for c in prof["cross_module_cards"]:
        sig = ", ".join(f"{k.split('.', 1)[1]} {v}" for k, v in c["signal_counts"].items()) or "map signals only"
        w.append(f"  {c['card']:<24} [{c['family']}] strength {c['strength']:<6} {sig}")
    w.append("")
    w.append(f"work units ({len(prof['work_units'])} of up to {r['suggested_fanout']}):")
    for u in prof["work_units"]:
        cards = "; ".join(f"{b}: {', '.join(cs)}" for b, cs in u["cards_by_bundle"].items()) or "(none routed)"
        w.append(f"  {u['id']} ({fmt(u['loc'])} lines) {', '.join(u['modules'])}")
        if u["unrouted_modules"]:
            w.append(f"    also read, no signals: {', '.join(u['unrouted_modules'])}")
        w.append(f"    load -> {cards}" + (f"   deferred: {', '.join(u['deferred_cards'])}" if u["deferred_cards"] else ""))
    w.append("")
    w.append("top modules by signal strength:")
    for m in [m for m in prof["modules"] if m["card_strength"]][:12]:
        top = ", ".join(f"{c} {v}" for c, v in list(m["card_strength"].items())[:4])
        w.append(f"  {m['id']:<40} {fmt(m['loc']):>7} lines  {top}")
    w.append("")
    w.append(f"full profile: {out_path}  ({prof['elapsed_s']}s)")
    print("\n".join(w))


# ---------------------------------------------------------------- check

IMPLEMENTED = {
    "metric": {
        "reinvented-logic.duplicate-name", "reinvented-logic.literal-clone",
        "inconsistent-solutions.dependency-family", "inconsistent-solutions.mixed-error-idioms",
        "scattered-knowledge.repeated-literal", "overloaded-module.large-file", "overloaded-module.many-exports",
        "tangled-function.brain-function", "tangled-function.deep-nesting", "tangled-function.many-params",
        "shallow-modules.pass-through", "shallow-modules.fragmented-module", "misleading-interface.query-name-writes",
        "toothless-tests.assertion-free-file", "implementation-coupled-tests.mock-heavy-file",
        "bloated-test-setup.duplicate-setup", "narrating-comments.comment-dense-file",
    },
    "git": {"scattered-knowledge.co-change", "overloaded-module.hotspot"},
    "map": {
        "import-tangle.cycle", "import-tangle.hub", "dead-code.unimported-export", "dead-code.orphan-file",
        "shallow-modules.shallow-interface", "speculative-generality.single-implementation",
        "speculative-generality.test-only-export",
    },
}
KINDS = {"grep", "path", "metric", "git", "map", "model", "probe"}
BUNDLES = {"source", "test", "module", "map"}
FAMILIES = {"duplication", "abstraction", "graph"}
DIRECTIONS = {"remove", "reshape", "add", "test", "safety"}
BEHAVIORS = {"preserving", "changes-failure-paths", "changes-behavior"}
RISKS = {"low", "medium", "high"}
MD_LINK_RE = re.compile(r"\]\(([^)#\s]+\.md)(?:#[^)]*)?\)")


def frontmatter(text):
    """Flat YAML frontmatter: `key: value` and `key: [a, b]` lines only."""
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    out = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        v = v.strip()
        out[k.strip()] = [x.strip() for x in v[1:-1].split(",") if x.strip()] if v.startswith("[") else v
    return out


def check_cards(signals, keys, errors):
    smells_dir, refs_dir = SKILL_ROOT / "smells", SKILL_ROOT / "refactors"
    smell_slugs = {p.stem for p in smells_dir.glob("*.md")}
    ref_slugs = {p.stem for p in refs_dir.glob("*.md")}
    for card in signals["cards"]:
        if card not in smell_slugs:
            errors.append(f"smells/{card}.md is missing")
    for md in sorted(smells_dir.glob("*.md")):
        text, card, where = md.read_text(), md.stem, f"smells/{md.name}"
        fm = frontmatter(text) or {}
        if card not in signals["cards"]:
            errors.append(f"{where}: no card {card!r} in signals.json")
            continue
        sc = signals["cards"][card]
        if fm.get("card") != card:
            errors.append(f"{where}: frontmatter card should be {card!r}")
        for field in ("scope", "bundle", "family"):
            if sc.get(field) and fm.get(field) != sc[field]:
                errors.append(f"{where}: {field} {fm.get(field)!r} disagrees with signals.json {sc[field]!r}")
        for s in fm.get("also_check", []):
            if s not in smell_slugs:
                errors.append(f"{where}: also_check {s!r} is not a smell card")
        for r in fm.get("refactors", []):
            if r not in ref_slugs:
                errors.append(f"{where}: refactor {r!r} has no card")
        linked = set(re.findall(r"\]\(\.\./refactors/([a-z0-9-]+)\.md\)", text))
        for r in linked - set(fm.get("refactors", [])):
            errors.append(f"{where}: links refactor {r!r} but frontmatter doesn't list it")
        for r in set(fm.get("refactors", [])) - linked:
            errors.append(f"{where}: frontmatter lists refactor {r!r} but the card never links it")
        found = set(re.findall(r"`(" + re.escape(card) + r"\.[a-z0-9-]+)`", text))
        for k in found - keys:
            errors.append(f"{where}: mentions unknown signal {k}")
        for k in {k for k in keys if k.startswith(card + ".")} - found:
            errors.append(f"{where}: does not document signal {k}")
    for md in sorted(refs_dir.glob("*.md")):
        text, where = md.read_text(), f"refactors/{md.name}"
        fm = frontmatter(text) or {}
        if fm.get("refactor") != md.stem:
            errors.append(f"{where}: frontmatter refactor should be {md.stem!r}")
        for field, allowed in (("direction", DIRECTIONS), ("behavior", BEHAVIORS), ("risk", RISKS)):
            if fm.get(field) not in allowed:
                errors.append(f"{where}: {field} {fm.get(field)!r} not in {sorted(allowed)}")
        for s in fm.get("smells", []):
            if s not in smell_slugs:
                errors.append(f"{where}: smell {s!r} has no card")
        for r in fm.get("requires", []):
            if r not in ref_slugs:
                errors.append(f"{where}: requires {r!r} has no card")
    for md in [SKILL_ROOT / "SKILL.md", *sorted(smells_dir.glob("*.md")), *sorted(refs_dir.glob("*.md")),
               *sorted((SKILL_ROOT / "references").glob("*.md"))]:
        if not md.exists():
            continue
        for target in MD_LINK_RE.findall(md.read_text()):
            if not (md.parent / target).resolve().exists():
                errors.append(f"{md.relative_to(SKILL_ROOT)}: broken link {target}")
    return len(smell_slugs), len(ref_slugs)


def check(signals):
    errors, pending = [], []
    keys = set()
    for card, c in signals["cards"].items():
        if c.get("scope") not in ("local", "cross"):
            errors.append(f"{card}: scope must be local or cross")
        if c.get("bundle") not in BUNDLES:
            errors.append(f"{card}: unknown bundle {c.get('bundle')!r}")
        if c.get("scope") == "cross" and c.get("family") not in FAMILIES:
            errors.append(f"{card}: cross cards need a family in {sorted(FAMILIES)}")
        for name, s in c["signals"].items():
            key = f"{card}.{name}"
            keys.add(key)
            kind = s.get("kind")
            if kind not in KINDS:
                errors.append(f"{key}: unknown kind {kind!r}")
            elif kind == "grep":
                if not s.get("patterns"):
                    errors.append(f"{key}: grep signal has no patterns")
                for lang, rx in s.get("patterns", {}).items():
                    if lang not in ("js", "py"):
                        errors.append(f"{key}: unknown language {lang!r}")
                    try:
                        re.compile(rx, re.M)
                    except re.error as e:
                        errors.append(f"{key} [{lang}]: {e}")
                if s.get("files") not in ("source", "test", "all"):
                    errors.append(f"{key}: files must be source, test or all")
            elif kind == "path":
                try:
                    re.compile(s["pattern"])
                except (KeyError, re.error) as e:
                    errors.append(f"{key}: {e}")
            elif kind in IMPLEMENTED and key not in IMPLEMENTED[kind]:
                errors.append(f"{key}: {kind} signal is not implemented in recon.py")
            elif kind in ("model", "probe"):
                pending.append(key)
    for kind, impl in IMPLEMENTED.items():
        for key in impl - keys:
            errors.append(f"{key}: implemented in recon.py but missing from signals.json")
    n_smells = n_refs = 0
    if (SKILL_ROOT / "smells").is_dir():
        n_smells, n_refs = check_cards(signals, keys, errors)
    else:
        print("note: smells/ not found; skipped card cross-check")
    print(f"{len(signals['cards'])} cards in signals.json, {len(keys)} signals "
          f"({len(pending)} filled by the model pass or probes); {n_smells} smell cards, {n_refs} refactor cards")
    for e in errors:
        print("error:", e)
    print("ok" if not errors else f"{len(errors)} error(s)")
    return 0 if not errors else 1


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(prog="recon.py", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("profile", help="profile the repository (read-only)")
    p.add_argument("--root", default=None, help="repository root (default: git toplevel of cwd, else cwd)")
    p.add_argument("--diff", metavar="BASE", help="scope signals to changes since BASE (e.g. origin/main)")
    p.add_argument("--out", default=None, help="output directory (default: <root>/.refactor)")
    p.add_argument("--window-days", type=int, default=90)
    p.add_argument("--co-change-min", type=int, default=3)
    p.add_argument("--budget", type=int, default=None, help="cards per work unit (default from signals.json)")
    mp = sub.add_parser("map", help="build the tier 1 module map: imports, exports, interface depth")
    mp.add_argument("--root", default=None)
    mp.add_argument("--diff", metavar="BASE", help="report map signals only for modules touched since BASE")
    mp.add_argument("--out", default=None)
    sub.add_parser("check", help="validate signals.json and the cards")
    args = ap.parse_args(argv)

    signals = json.loads(SIGNALS_PATH.read_text())
    if args.cmd == "check":
        return check(signals)

    if args.root:
        root = Path(args.root).resolve()
    else:
        top = git(Path.cwd(), "rev-parse", "--show-toplevel")
        root = Path(top.strip()) if top else Path.cwd()
    out_dir = Path(args.out).resolve() if args.out else root / ".refactor"
    out_dir.mkdir(parents=True, exist_ok=True)
    gi = out_dir / ".gitignore"
    if not gi.exists():
        gi.write_text("*\n!.gitignore\n!map.md\n!ledger.jsonl\n")

    if args.cmd == "map":
        prof = Profile(root, signals, 90, 3, args.diff)
        prof.collect()
        prof.split_large_modules()
        if args.diff:
            prof.run_diff()
        m = ModuleMap(prof).build()
        (out_dir / "map.json").write_text(json.dumps(m, indent=1) + "\n")
        todo = write_map_md(m, out_dir / "map.md")
        summarize_map(m, out_dir, todo)
        return 0

    prof = Profile(root, signals, args.window_days, args.co_change_min, args.diff).build(args.budget or signals["budget"])
    out_path = out_dir / "profile.json"
    out_path.write_text(json.dumps(prof, indent=1) + "\n")
    summarize(prof, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
