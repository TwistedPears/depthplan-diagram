import type { RecursiveDocument } from './recursiveDocument';
import { contentText, objectLabel } from './recursiveScene';
import { hasTag, resolveTag } from './tags';

export function searchTerms(query: string) {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesSearch(text: string, terms: string[]) {
  const searchable = text.toLowerCase();
  return terms.length > 0 && terms.every((term) => searchable.includes(term));
}

/** UI search: `tag:Name` or `tag:"Two words"` terms keep objects carrying every named tag. */
export function searchObjects(document: RecursiveDocument, query: string) {
  const tagNames: string[] = [];
  const words = searchTerms(
    query.replace(
      /(?<!\S)tag:(?:"([^"]*)"|(\S+))/gi,
      (_, quoted?: string, bare?: string) => {
        tagNames.push(quoted ?? bare ?? '');
        return ' ';
      },
    ),
  );
  const tags = tagNames.map((name) => resolveTag(document, name)?.id);
  if (!words.length && !tags.length) return [];
  return Object.values(document.objects).flatMap((object) => {
    const text = contentText(object.content).replace(/\s+/g, ' ').trim();
    return tags.every((tag) => hasTag(object, tag)) &&
      (!words.length || matchesSearch(`${object.name} ${text}`, words))
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
