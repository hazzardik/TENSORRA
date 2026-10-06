"use client";

type RenderLine = {
  text: string;
  kind: "title" | "h1" | "h2" | "h3" | "body" | "bullet" | "code" | "quote";
};

function normalizeMathForPdf(value: string) {
  let output = value
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\\boxed\{([^{}]+)\}/g, "$1")
    .replace(/\\(?:d?frac|tfrac)\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\\begin\{(?:p|b|v|V)matrix\}/g, "[")
    .replace(/\\end\{(?:p|b|v|V)matrix\}/g, "]")
    .replace(/\\begin\{cases\}/g, "{ ")
    .replace(/\\end\{cases\}/g, " }")
    .replace(/\\begin\{aligned\}|\\end\{aligned\}/g, "")
    .replace(/\\Rightarrow|\\implies/g, "⇒")
    .replace(/\\Leftrightarrow/g, "⇔")
    .replace(/\\leq?|\\le/g, "≤")
    .replace(/\\geq?|\\ge/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\pm/g, "±")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\angle/g, "∠")
    .replace(/\\circ/g, "°")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\\\/g, "; ")
    .replace(/&/g, " ")
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .replace(/_\{([^{}]+)\}/g, "_$1")
    .replace(/\\left|\\right/g, "")
    .replace(/\\text\{([^{}]+)\}/g, "$1");

  output = output.replace(/\\[A-Za-z]+/g, "");
  return output.replace(/\s{2,}/g, " ").trim();
}

function stripMarkdown(value: string) {
  const cleaned = value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();

  return normalizeMathForPdf(cleaned);
}

function parseMarkdown(markdown: string): RenderLine[] {
  const result: RenderLine[] = [];
  let inCode = false;

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("\x60\x60\x60")) {
      inCode = !inCode;
      continue;
    }

    if (!trimmed) {
      result.push({ text: "", kind: "body" });
      continue;
    }

    if (inCode) {
      result.push({ text: line, kind: "code" });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const kind = heading[1].length === 1
        ? "h1"
        : heading[1].length === 2
          ? "h2"
          : "h3";
      result.push({ text: stripMarkdown(heading[2]), kind });
      continue;
    }

    const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      result.push({
        text: ordered[1] + ". " + stripMarkdown(ordered[2]),
        kind: "bullet",
      });
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      result.push({ text: "• " + stripMarkdown(bullet[1]), kind: "bullet" });
      continue;
    }

    if (trimmed.startsWith(">")) {
      result.push({
        text: stripMarkdown(trimmed.replace(/^>\s?/, "")),
        kind: "quote",
      });
      continue;
    }

    result.push({ text: stripMarkdown(trimmed), kind: "body" });
  }

  return result;
}

function safeFilename(title: string) {
  const cleaned = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);

  return cleaned || "TENSORRA";
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }

  return out;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (!text) return [""];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function styleFor(kind: RenderLine["kind"]) {
  if (kind === "title") return { size: 30, weight: 700, color: "#0f172a", before: 0, after: 22 };
  if (kind === "h1") return { size: 25, weight: 700, color: "#0f172a", before: 18, after: 10 };
  if (kind === "h2") return { size: 21, weight: 700, color: "#111827", before: 16, after: 9 };
  if (kind === "h3") return { size: 18, weight: 700, color: "#1f2937", before: 14, after: 8 };
  if (kind === "code") return { size: 14, weight: 500, color: "#24324a", before: 2, after: 4 };
  if (kind === "quote") return { size: 16, weight: 500, color: "#475569", before: 4, after: 8 };
  if (kind === "bullet") return { size: 16, weight: 500, color: "#1f2937", before: 2, after: 4 };
  return { size: 16, weight: 500, color: "#1f2937", before: 1, after: 7 };
}

function renderPages(markdown: string, title: string) {
  const width = 1240;
  const height = 1754;
  const marginX = 96;
  const marginTop = 100;
  const marginBottom = 100;
  const maxWidth = width - marginX * 2;
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = width;
  pageCanvas.height = height;

  const ctx = pageCanvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен.");

  const pages: Uint8Array[] = [];
  let y = marginTop;

  const resetPage = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    y = marginTop;
  };

  const finishPage = () => {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 12px -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("TENSORRA", marginX, height - 42);
    ctx.textAlign = "right";
    ctx.fillText(String(pages.length + 1), width - marginX, height - 42);
    ctx.textAlign = "left";

    const dataUrl = pageCanvas.toDataURL("image/jpeg", 0.93);
    pages.push(base64ToBytes(dataUrl.split(",")[1] || ""));
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= height - marginBottom) return;
    finishPage();
    resetPage();
  };

  const drawLine = (item: RenderLine) => {
    const style = styleFor(item.kind);
    const leftIndent = item.kind === "bullet" || item.kind === "quote" ? 22 : 0;
    const availableWidth = maxWidth - leftIndent;
    const fontFamily = item.kind === "code"
      ? "ui-monospace, SFMono-Regular, Consolas, monospace"
      : "-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif";

    ctx.font = String(style.weight) + " " + String(style.size) + "px " + fontFamily;
    ctx.fillStyle = style.color;

    if (!item.text) {
      ensureSpace(16);
      y += 16;
      return;
    }

    const wrapped = wrapText(ctx, item.text, availableWidth);
    const lineHeight = Math.round(style.size * 1.48);
    const needed = style.before + wrapped.length * lineHeight + style.after;
    ensureSpace(needed);

    y += style.before;

    if (item.kind === "quote") {
      ctx.fillStyle = "#b7c2d0";
      ctx.fillRect(marginX, y, 4, Math.max(lineHeight, wrapped.length * lineHeight - 4));
      ctx.fillStyle = style.color;
    }

    for (const line of wrapped) {
      ctx.fillText(line, marginX + leftIndent, y + lineHeight);
      y += lineHeight;
    }

    y += style.after;
  };

  resetPage();
  drawLine({ text: title, kind: "title" });

  for (const item of parseMarkdown(markdown)) {
    drawLine(item);
  }

  finishPage();
  return { pages, width, height };
}

function buildPdf(
  images: Uint8Array[],
  imageWidth: number,
  imageHeight: number,
) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const objectCount = 2 + images.length * 3;
  const objects: Array<Uint8Array | null> = Array(objectCount + 1).fill(null);

  objects[1] = textBytes("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageIds = images.map((_, index) => 3 + index * 3);
  objects[2] = textBytes(
    "2 0 obj\n<< /Type /Pages /Count " +
      String(images.length) +
      " /Kids [" +
      pageIds.map((id) => String(id) + " 0 R").join(" ") +
      "] >>\nendobj\n",
  );

  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;

    objects[pageId] = textBytes(
      String(pageId) +
        " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
        String(pageWidth) +
        " " +
        String(pageHeight) +
        "] /Resources << /XObject << /Im0 " +
        String(imageId) +
        " 0 R >> >> /Contents " +
        String(contentId) +
        " 0 R >>\nendobj\n",
    );

    const imageHead = textBytes(
      String(imageId) +
        " 0 obj\n<< /Type /XObject /Subtype /Image /Width " +
        String(imageWidth) +
        " /Height " +
        String(imageHeight) +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
        String(image.length) +
        " >>\nstream\n",
    );
    const imageTail = textBytes("\nendstream\nendobj\n");
    objects[imageId] = concatBytes([imageHead, image, imageTail]);

    const drawCommand =
      "q " +
      String(pageWidth) +
      " 0 0 " +
      String(pageHeight) +
      " 0 0 cm /Im0 Do Q";
    objects[contentId] = textBytes(
      String(contentId) +
        " 0 obj\n<< /Length " +
        String(drawCommand.length) +
        " >>\nstream\n" +
        drawCommand +
        "\nendstream\nendobj\n",
    );
  });

  const header = textBytes("%PDF-1.4\n");
  const chunks: Uint8Array[] = [header];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let position = header.length;

  for (let id = 1; id <= objectCount; id += 1) {
    const object = objects[id];
    if (!object) continue;
    offsets[id] = position;
    chunks.push(object);
    position += object.length;
  }

  const xrefOffset = position;
  let xref = "xref\n0 " + String(objectCount + 1) + "\n";
  xref += "0000000000 65535 f \n";

  for (let id = 1; id <= objectCount; id += 1) {
    xref += String(offsets[id]).padStart(10, "0") + " 00000 n \n";
  }

  xref +=
    "trailer\n<< /Size " +
    String(objectCount + 1) +
    " /Root 1 0 R >>\nstartxref\n" +
    String(xrefOffset) +
    "\n%%EOF";

  chunks.push(textBytes(xref));
  return concatBytes(chunks);
}

export async function exportAnswerToPdf(args: {
  content: string;
  title?: string;
}) {
  const title = args.title?.trim() || "Материал TENSORRA";
  const rendered = renderPages(args.content, title);
  const bytes = buildPdf(rendered.pages, rendered.width, rendered.height);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename(title) + ".pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
