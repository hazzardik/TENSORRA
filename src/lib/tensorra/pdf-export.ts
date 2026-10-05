"use client";

type PdfMakeRuntime = {
  vfs?: Record<string, string>;
  fonts?: Record<string, {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  }>;
  createPdf: (definition: unknown) => {
    download: (filename: string) => void;
  };
};

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}

function markdownToPdfContent(markdown: string) {
  const blocks: Array<Record<string, unknown>> = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let codeBuffer: string[] = [];
  let inCode = false;

  const flushCode = () => {
    if (!codeBuffer.length) return;
    blocks.push({
      text: codeBuffer.join("\n"),
      style: "code",
      margin: [0, 5, 0, 9],
    });
    codeBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith("\x60\x60\x60")) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push({ text: " ", fontSize: 4, margin: [0, 1, 0, 1] });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        text: cleanInlineMarkdown(heading[2]),
        style: heading[1].length === 1 ? "h1" : heading[1].length === 2 ? "h2" : "h3",
        margin: [0, heading[1].length === 1 ? 10 : 8, 0, 5],
      });
      continue;
    }

    const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      blocks.push({
        text: ordered[1] + ". " + cleanInlineMarkdown(ordered[2]),
        margin: [12, 2, 0, 2],
      });
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      blocks.push({
        text: "• " + cleanInlineMarkdown(bullet[1]),
        margin: [12, 2, 0, 2],
      });
      continue;
    }

    if (trimmed.startsWith(">")) {
      blocks.push({
        text: cleanInlineMarkdown(trimmed.replace(/^>\s?/, "")),
        style: "quote",
        margin: [10, 5, 0, 7],
      });
      continue;
    }

    blocks.push({
      text: cleanInlineMarkdown(trimmed),
      style: "body",
      margin: [0, 2, 0, 5],
    });
  }

  flushCode();
  return blocks;
}

function safeFilename(title: string) {
  const cleaned = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);

  return cleaned || "TENSORRA";
}

export async function exportAnswerToPdf(args: {
  content: string;
  title?: string;
}) {
  const [pdfMakeModule, fontsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);

  const pdfMake = (
    (pdfMakeModule as { default?: unknown }).default ?? pdfMakeModule
  ) as unknown as PdfMakeRuntime;

  const fontsExport = (
    (fontsModule as { default?: unknown }).default ?? fontsModule
  ) as unknown as {
    vfs?: Record<string, string>;
    pdfMake?: { vfs?: Record<string, string> };
  };

  const vfs = fontsExport.vfs ?? fontsExport.pdfMake?.vfs;
  if (vfs) pdfMake.vfs = vfs;

  pdfMake.fonts = {
    Roboto: {
      normal: "Roboto-Regular.ttf",
      bold: "Roboto-Medium.ttf",
      italics: "Roboto-Italic.ttf",
      bolditalics: "Roboto-MediumItalic.ttf",
    },
  };

  const title = args.title?.trim() || "Материал TENSORRA";
  const definition = {
    pageSize: "A4",
    pageMargins: [46, 48, 46, 52],
    defaultStyle: {
      font: "Roboto",
      fontSize: 11,
      lineHeight: 1.28,
      color: "#111827",
    },
    content: [
      {
        text: title,
        style: "title",
        margin: [0, 0, 0, 16],
      },
      ...markdownToPdfContent(args.content),
    ],
    styles: {
      title: {
        fontSize: 19,
        bold: true,
        color: "#0f172a",
      },
      h1: {
        fontSize: 17,
        bold: true,
        color: "#0f172a",
      },
      h2: {
        fontSize: 14,
        bold: true,
        color: "#111827",
      },
      h3: {
        fontSize: 12,
        bold: true,
        color: "#1f2937",
      },
      body: {
        fontSize: 11,
      },
      quote: {
        fontSize: 10.5,
        color: "#475569",
        italics: true,
      },
      code: {
        fontSize: 9,
        color: "#172033",
        background: "#f1f5f9",
      },
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: "TENSORRA",
          alignment: "left",
          margin: [46, 12, 0, 0],
          fontSize: 8,
          color: "#94a3b8",
        },
        {
          text: String(currentPage) + " / " + String(pageCount),
          alignment: "right",
          margin: [0, 12, 46, 0],
          fontSize: 8,
          color: "#94a3b8",
        },
      ],
    }),
  };

  pdfMake.createPdf(definition).download(safeFilename(title) + ".pdf");
}
