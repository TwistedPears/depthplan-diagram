import type { RecursiveDocument } from './recursiveDocument';
import { contentText, objectLabel } from './recursiveScene';

export function searchTerms(query: string) {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesSearch(text: string, terms: string[]) {
  const searchable = text.toLowerCase();
  return terms.length > 0 && terms.every((term) => searchable.includes(term));
}

export function searchObjects(document: RecursiveDocument, query: string) {
  const words = searchTerms(query);
  if (!words.length) return [];
  return Object.values(document.objects).flatMap((object) => {
    const text = contentText(object.content).replace(/\s+/g, ' ').trim();
    return matchesSearch(`${object.name} ${text}`, words)
      ? [
          {
            id: object.id,
            label: objectLabel(object),
            text: text.slice(0, 200),
          },
        ]
      : [];
  });
}
