import { recursiveFixture } from './recursiveFixtures';
import {
  validProjectLink,
  validLink,
  validateRecursiveDocument,
} from '../shared/recursiveDocument';
import { duplicateSelection } from '../shared/recursiveDuplication';
import {
  copySelection,
  pasteSelection,
  readSelection,
} from '../shared/recursiveClipboard';
import { transactDocument } from '../shared/documentTransactions';

test('v2 internal references round-trip and retain exact targets through object duplicate and clipboard copies', () => {
  const doc = recursiveFixture();
  const link = { projectId: 'project', boardId: doc.id, bookmarkId: 'detail' };
  doc.objects.app.projectLink = link;
  validateRecursiveDocument(doc);
  expect(JSON.parse(JSON.stringify(doc)).objects.app.projectLink).toEqual(link);
  const copied = duplicateSelection(doc, ['object-app']);
  const result = transactDocument(doc, copied.edit);
  expect(result.status).toBe('accepted');
  if (result.status !== 'accepted') throw new Error('Duplicate failed');
  expect(
    result.document.objects[copied.selection[0].slice(7)].projectLink,
  ).toEqual(link);
  const clipboard = readSelection(copySelection(doc, ['object-app']))!;
  const paste = pasteSelection(clipboard, 24);
  const pasted = transactDocument(doc, paste.edit);
  if (pasted.status !== 'accepted') throw new Error('Paste failed');
  expect(
    pasted.document.objects[paste.selection[0].slice(7)].projectLink,
  ).toEqual(link);
});

test('internal links are explicit bounded identities and never weaken URL validation', () => {
  for (const value of [
    null,
    'file:///tmp/board',
    {},
    { projectId: 'p', boardId: '../board' },
    { projectId: 'p', boardId: 'b', path: '/tmp/x' },
    { projectId: 'p', boardId: 'b', bookmarkId: '__proto__' },
    { projectId: 'p', boardId: 'b', bookmarkId: '😀'.repeat(129) },
  ])
    expect(validProjectLink(value)).toBe(false);
  for (const link of [
    { projectId: 'p', boardId: 'b' },
    { projectId: 'p', boardId: 'b', bookmarkId: '😀'.repeat(128) },
  ])
    expect(validProjectLink(link)).toBe(true);
  for (const url of [
    'file:///tmp/a',
    'depthplan://project/board',
    'javascript:alert(1)',
    'https://name:secret@example.com',
  ])
    expect(validLink(url)).toBe(false);
  expect(validLink('https://example.com')).toBe(true);
  const doc = recursiveFixture();
  (doc.objects.app as unknown as Record<string, unknown>).projectLink = {
    projectId: 'p',
    boardId: 'b',
    executable: 'evil',
  };
  expect(() => validateRecursiveDocument(doc)).toThrow('project link');
});
