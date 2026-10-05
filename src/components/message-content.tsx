"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const MATH_ENV_RE =
  /\\begin\{(pmatrix|bmatrix|vmatrix|Vmatrix|cases|aligned|array)\}[\s\S]*?\\end\{\1\}/g;

function repairEnvironment(source: string) {
  return source.replace(
    /(\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|cases|aligned|array)\})([\s\S]*?)(\\end\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|cases|aligned|array)\})/g,
    (_match, begin: string, body: string, end: string) => {
      const repaired = body.replace(
        /\\(?=\s+(?:[-+]?\d|[A-Za-zА-Яа-яЁё]))/g,
        "\\\\",
      );
      return begin + repaired + end;
    },
  );
}

function looksLikeStandaloneMath(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("$")) return false;
  if (/[А-Яа-яЁё]{3,}/.test(trimmed)) return false;

  const latexSignal =
    /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|log|ln|sin|cos|tan|cot|begin|left|right|angle|cdot|times)|\^\{|_\{|[A-Za-z]\s*=/.test(
      trimmed,
    );

  const equationSignal =
    /[=<>≤≥]\s*[-+]?\s*(?:\d|[A-Za-z]|\\)/.test(trimmed);

  return latexSignal || equationSignal;
}

function normalizeTextChunk(chunk: string) {
  let normalized = chunk
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, inner: string) =>
      "\n$$\n" + repairEnvironment(inner.trim()) + "\n$$\n",
    )
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, inner: string) =>
      "$" + inner.trim() + "$",
    )
    .replace(/^\s*\$\s*$/gm, () => "$$");

  normalized = normalized.replace(
    MATH_ENV_RE,
    (match: string, _environment: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 8), offset);
      const after = whole.slice(offset + match.length, offset + match.length + 8);

      if (/\$\$\s*$/.test(before) && /^\s*\$\$/.test(after)) {
        return repairEnvironment(match);
      }

      return "\n$$\n" + repairEnvironment(match) + "\n$$\n";
    },
  );

  normalized = normalized
    .split("\n")
    .map((line) => {
      if (looksLikeStandaloneMath(line)) {
        const value = line.trim().replace(/^\[\s*/, "").replace(/\s*\]$/, "");
        return "$" + repairEnvironment(value) + "$";
      }
      return line;
    })
    .join("\n");

  return normalized
    .replace(/\$\$\s*\$\$/g, "$$")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeMathMarkdown(content: string) {
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
