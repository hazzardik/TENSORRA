"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const ENV_NAMES = "pmatrix|bmatrix|vmatrix|Vmatrix|cases|aligned|array";
const MATH_ENV_RE = new RegExp(
  "\\\\begin\\{(" + ENV_NAMES + ")\\}[\\s\\S]*?\\\\end\\{\\1\\}",
  "g",
);

function repairEnvironment(source: string) {
  const env = new RegExp(
    "(\\\\begin\\{(?:" + ENV_NAMES + ")\\})([\\s\\S]*?)(\\\\end\\{(?:" + ENV_NAMES + ")\\})",
    "g",
  );

  return source.replace(
    env,
    (_match, begin: string, body: string, end: string) => {
      const repaired = body.replace(
        /\\(?=\s+(?:[-+]?\d|[A-Za-zА-Яа-яЁё]))/g,
        "\\\\",
      );
      return begin + repaired + end;
    },
  );
}

function countDisplayDelimiters(source: string) {
  return (source.match(/\$\$/g) ?? []).length;
}

function wrapBareEnvironments(source: string) {
  return source.replace(
    MATH_ENV_RE,
    (match: string, _env: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const insideDisplayMath = countDisplayDelimiters(before) % 2 === 1;

      if (insideDisplayMath) {
        return repairEnvironment(match);
      }

      return "\n$$\n" + repairEnvironment(match) + "\n$$\n";
    },
  );
}

function looksLikeStandaloneMath(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("$")) return false;

  // Normal prose with long Russian words should not be swallowed by math mode.
  if (/[А-Яа-яЁё]{3,}/.test(trimmed)) return false;

  const latexSignal =
    /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|log|ln|sin|cos|tan|cot|left|right|angle|cdot|times)|\^\{|_\{/.test(
      trimmed,
    );

  const equationSignal =
    /^[\sA-Za-z0-9{}_[\]()+\-*/=<>.,:^&\\]+$/.test(trimmed) &&
    /[=<>^]|\\(?:sqrt|frac|dfrac)/.test(trimmed);

  return latexSignal || equationSignal;
}

function normalizeLines(source: string) {
  const lines = source.split("\n");
  let displayOpen = false;

  return lines
    .map((line) => {
      const trimmed = line.trim();

      if (trimmed === "$$") {
        displayOpen = !displayOpen;
        return "$$";
      }

      if (displayOpen) {
        return repairEnvironment(line);
      }

      if (looksLikeStandaloneMath(line)) {
        const value = line
          .trim()
          .replace(/^\[\s*/, "")
          .replace(/\s*\]$/, "");
        return "$" + repairEnvironment(value) + "$";
      }

      return line;
    })
    .join("\n");
}

function normalizeTextChunk(chunk: string) {
  let normalized = chunk
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, inner: string) =>
      "\n$$\n" + repairEnvironment(inner.trim()) + "\n$$\n",
    )
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, inner: string) =>
      "$" + inner.trim() + "$",
    )
    // Some provider outputs put a single "$" on its own line as if it were
    // a display delimiter. Treat it as "$$" before Markdown parsing.
    .replace(/^\s*\$\s*$/gm, () => "$$");

  normalized = wrapBareEnvironments(normalized);
  normalized = normalizeLines(normalized);

  return normalized
    .replace(/\$\$\s*\$\$/g, () => "$$")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeMathMarkdown(content: string) {
  // Never rewrite fenced code blocks: LaTeX/code examples inside them are data.
  const chunks = content.split(/(```[\s\S]*?```)/g);

  return chunks
    .map((chunk, index) => (index % 2 === 1 ? chunk : normalizeTextChunk(chunk)))
    .join("");
}

export default function MessageContent({ content }: { content: string }) {
  const normalized = normalizeMathMarkdown(content);

  return (
    <div className="markdownBody">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              throwOnError: false,
              strict: "ignore",
              errorColor: "#d7e0ec",
            },
          ],
        ]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="markdownCodeBlock">{children}</pre>
          ),
          code: ({ children, className }) => (
            <code className={className}>{children}</code>
          ),
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
