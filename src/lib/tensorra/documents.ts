import { PDFParse } from "pdf-parse";

export async function extractDocumentText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.type === "application/pdf" || file.name.toLocaleLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text?.trim() ?? "";
    } finally {
      await parser.destroy();
    }
  }

  return buffer.toString("utf8").trim();
}

export function chunkText(text: string, target = 1800, overlap = 220) {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [] as string[];

  const paragraphs = normalized.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= target) {
      current = next;
      continue;
    }

    if (current) chunks.push(current);
    const tail = current.slice(Math.max(0, current.length - overlap));
    current = tail ? `${tail}\n\n${paragraph}` : paragraph;

    while (current.length > target * 1.4) {
      chunks.push(current.slice(0, target));
      current = current.slice(Math.max(0, target - overlap));
    }
  }

  if (current) chunks.push(current);
  return chunks.slice(0, 1500);
}

export function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "document";
}
