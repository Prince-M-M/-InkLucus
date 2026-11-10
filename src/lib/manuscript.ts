export type ParsedChapter = { title: string; content: string };

export const MAX_CHAPTER_CHARS = 200_000;

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Splits a pasted manuscript into chapters. Each chapter starts with a line beginning with "# ".
 * Text before the first heading (or a manuscript with no headings) becomes "Chapter 1".
 */
export function parseManuscript(text: string): ParsedChapter[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const chapters: ParsedChapter[] = [];
  let title: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const content = buf.join("\n").trim();
    if (title !== null || content) {
      chapters.push({ title: title?.trim() || `Chapter ${chapters.length + 1}`, content });
    }
    buf = [];
  };

  for (const line of lines) {
    const m = /^#\s+(.*)$/.exec(line);
    if (m) {
      flush();
      title = m[1];
    } else {
      buf.push(line);
    }
  }
  flush();
  return chapters.filter((c) => c.content.length > 0);
}
