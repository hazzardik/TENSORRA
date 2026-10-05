"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

function normalizeMathMarkdown(content: string) {
  const chunks = content.split(/(```[\s\S]*?```)/g);

  return chunks.map((chunk, index) => {
    if (index % 2 === 1) return chunk;

    let normalized = chunk
      .replace(/\\\[/g, "\n$$\n")
      .replace(/\\\]/g, "\n$$\n")
      .replace(/\\\(/g, "$")
      .replace(/\\\)/g, "$");

    normalized = normalized
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();

        if (
          /\\begin\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|cases|aligned|array)\}/.test(trimmed) &&
          !trimmed.includes("$")
        ) {
          const withoutLooseBrackets = trimmed
            .replace(/^\[\s*/, "")
            .replace(/\s*\]$/, "");
          return "$$\n" + withoutLooseBrackets + "\n$$";
        }

        return line;
      })
      .join("\n");

    return normalized;
  }).join("");
}

export default function MessageContent({ content }: { content: string }) {
  const normalized = normalizeMathMarkdown(content);

  return (
    <div className="markdownBody">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
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
