/** Splits a book into purchasable sections (e.g. 50 chapters each). */
export function planSections(
  chapterCount: number,
  lockChapter: number,
  chaptersPerSection = 50,
): { index: number; firstChapter: number; lastChapter: number }[] {
  if (chaptersPerSection < 1) throw new Error("chaptersPerSection must be >= 1");
  const sections = [];
  let index = 1;
  for (let first = Math.max(1, lockChapter); first <= chapterCount; first += chaptersPerSection) {
    sections.push({ index: index++, firstChapter: first, lastChapter: Math.min(chapterCount, first + chaptersPerSection - 1) });
  }
  return sections;
}
