import {
  generateStressDocument,
  stressPresets,
  normalizeStressSettings,
} from '../shared/stressDocument';
import { validateRecursiveDocument } from '../shared/recursiveDocument';
import { indexHierarchy } from '../shared/recursiveHierarchy';

describe('reproducible stress workloads', () => {
  it.each(Object.keys(stressPresets))(
    '%s realizes exact settings and repeatable validated bytes',
    (preset) => {
      const settings = { ...stressPresets[preset], seed: 'test-seed' };
      const a = generateStressDocument(settings),
        b = generateStressDocument(settings);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(a.document)).not.toBe(
        JSON.stringify(
          generateStressDocument({ ...settings, seed: 'other-seed' }).document,
        ),
      );
      expect(() =>
        validateRecursiveDocument(JSON.parse(JSON.stringify(a.document))),
      ).not.toThrow();
      const hierarchy = indexHierarchy(a.document.objects);
      const levels = Array.from(
        { length: settings.depth + 1 },
        (_, d) => settings.roots * settings.breadth ** d,
      );
      expect(a.counts.objects).toBe(levels.reduce((n, size) => n + size, 0));
      for (let d = 0; d <= settings.depth; d++)
        expect(
          [...hierarchy.entries.values()].filter((e) => e.generation === d),
        ).toHaveLength(levels[d]);
      expect(a.counts.connections).toBe(
        Math.floor(a.counts.connectionCandidates * settings.connectionDensity),
      );
      expect(a.counts.visible + a.counts.hidden).toBe(a.counts.objects);
      expect(a.counts.savedLayouts).toBe(
        settings.roots * settings.savedLayouts,
      );
      if (settings.depthMode === 'all') expect(a.counts.hidden).toBe(0);
      else expect(a.counts.hidden).toBeGreaterThan(0);
      for (const object of Object.values(a.document.objects)) {
        const text = object.content.find((c) => c.type === 'paragraph');
        expect(
          text?.type === 'paragraph'
            ? text.runs.map((r) => r.text).join('').length
            : 0,
        ).toBe(settings.textCharacters);
        const code = object.content.find((c) => c.type === 'code');
        expect(
          code?.type === 'code' ? code.text.split('\r\n').length - 1 : 0,
        ).toBe(settings.codeLines);
      }
    },
  );
  it('normalizes omitted defaults and supports collapsed/empty content and depth zero', () => {
    expect(generateStressDocument({})).toEqual(
      generateStressDocument(normalizeStressSettings({})),
    );
    const { counts } = generateStressDocument({
      roots: 1,
      breadth: 0,
      depth: 0,
      savedLayouts: 1,
      depthMode: 'collapsed',
      textCharacters: 0,
      codeLines: 0,
    });
    expect(counts).toMatchObject({
      objects: 1,
      visible: 1,
      hidden: 0,
      connections: 0,
      textCharacters: 0,
      codeLines: 0,
    });
  });
  it.each([
    { roots: 0 },
    { breadth: 0 },
    { depth: -1 },
    { roots: 1.5 },
    { seed: '' },
    { connectionDensity: 1.1 },
    { connectionDensity: NaN },
    { textCharacters: -1 },
    { savedLayouts: 4 },
    { savedLayouts: 1 },
    { depthMode: 'invalid' },
    { codeLines: Infinity },
    { breadth: 20, depth: 100 },
    { depth: Number.MAX_SAFE_INTEGER, breadth: 1 },
    { unknown: true },
  ])(
    'rejects impossible or invalid settings %j without reducing work',
    (settings) => {
      expect(() => generateStressDocument(settings as never)).toThrow();
    },
  );
});
