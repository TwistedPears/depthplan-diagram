import type { RecursiveDocument } from './recursiveDocument';
import { contentText, objectLabel } from './recursiveScene';

export function searchObjects(document: RecursiveDocument, query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return Object.values(document.objects).flatMap((object) => {
    const text = contentText(object.content).replace(/\s+/g, ' ').trim();
    const searchable = `${object.name} ${text}`.toLocaleLowerCase();
    return words.every((word) => searchable.includes(word))
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
