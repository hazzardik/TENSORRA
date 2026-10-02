"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MessageContent({ content }: { content: string }) {
  return (
    <div className="markdownBody">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
