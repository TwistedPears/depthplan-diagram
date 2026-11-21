import { render } from '@testing-library/react';
import RecursiveScene from '../renderer/components/RecursiveScene';
import { transactDocument } from '../shared/documentTransactions';
import { recursiveScene } from '../shared/recursiveScene';
import { editTagDefinition, setEntityTags } from '../shared/tags';
import { recursiveFixture } from './recursiveFixtures';

// Konva nodes render as plain elements carrying their name, id and text.
jest.mock('react-konva', () => {
  const React = jest.requireActual('react');
  const node =
    (kind: string) =>
    ({
      children,
      name,
      id,
      text,
      dash,
    }: {
      children?: unknown;
      name?: string;
      id?: string;
      text?: string;
      dash?: number[];
    }) =>
      React.createElement(
        'div',
        { 'data-kind': kind, 'data-name': name, 'data-dash': dash?.join(), id },
        text ?? children,
      );
  return Object.fromEntries(
    ['Group', 'Text', 'Rect', 'Line', 'Circle', 'Ellipse'].map((kind) => [
      kind,
      node(kind),
    ]),
  );
});

beforeAll(() => {
  // ConnectionPaint samples its stroke color through a 2D context.
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect() {},
    fillRect() {},
    getImageData: () => ({ data: [0, 0, 0, 255] }),
    measureText: (text: string) => ({ width: text.length * 7 }),
  })) as never;
});

it('paints object and connection pills, the tag line style and a derived legend', () => {
  const result = transactDocument(recursiveFixture(), (draft) => {
    editTagDefinition('create', 'confirm', {
      name: 'To confirm',
      color: '#d97706',
      strokeStyle: 'dotted',
    })(draft);
    draft.connections.wire = {
      id: 'wire',
      ownerId: null,
      kind: 'line',
      z: 0,
      start: { kind: 'free', x: 0, y: 300 },
      end: { kind: 'free', x: 200, y: 300 },
    };
    setEntityTags('add', ['confirm'], ['payments'], ['wire'])(draft);
    draft.objects.app.style = { legend: true };
    draft.rootDepths.app = 0;
    draft.layouts.app[0].app.height = 200;
  });
  const document = result.document;
  const { container } = render(
    <RecursiveScene
      document={document}
      scene={recursiveScene(document)}
      onError={jest.fn()}
    />,
  );
  const payments = container.querySelector('#object-payments')!;
  expect(
    payments.querySelector('[data-name="object-content object-tags"]')
      ?.textContent,
  ).toBe('To confirm');
  // The line paints in z order; its label and pills paint in a later pass.
  const [wire, wireLabel] = container.querySelectorAll('#connection-wire');
  expect(
    wireLabel.querySelector('[data-name="connection-tags"]')?.textContent,
  ).toBe('To confirm');
  expect(wire.querySelector('[data-name="connection-tags"]')).toBeNull();
  expect(
    wire
      .querySelector('[data-name="connection-path"]')
      ?.getAttribute('data-dash'),
  ).toBe('2,4');
  // The legend object's body is replaced by the derived legend.
  const legend = container
    .querySelector('#object-app')!
    .querySelector('[data-name="object-content"]')!.textContent;
  expect(legend).toContain('Tags');
  expect(legend).toContain('To confirm');
  expect(legend).toContain('(2)');
  expect(legend).not.toContain('app ');
});

it('marks clipped bodies on the canvas and leaves fitting ones unmarked', () => {
  const document = recursiveFixture();
  document.objects.api.content = [
    {
      type: 'paragraph',
      runs: [{ text: Array.from({ length: 40 }, () => 'word').join(' ') }],
    },
  ];
  const { container } = render(
    <RecursiveScene
      document={document}
      scene={recursiveScene(document)}
      onError={jest.fn()}
    />,
  );
  const marker = '[data-name="object-content object-overflow"]';
  expect(container.querySelector(`#object-api ${marker}`)).not.toBeNull();
  expect(container.querySelector(`#object-payments ${marker}`)).toBeNull();
});

it('paints connection labels above every connection line of their container', () => {
  const result = transactDocument(recursiveFixture(), (draft) => {
    for (const [id, y] of [
      ['across', 300],
      ['down', 250],
    ] as const)
      draft.connections[id] = {
        id,
        ownerId: null,
        kind: 'arrow',
        z: 0,
        label: id,
        start: { kind: 'free', x: id === 'down' ? 100 : 0, y },
        end: { kind: 'free', x: id === 'down' ? 100 : 200, y: y + 100 },
      };
  });
  const { container } = render(
    <RecursiveScene
      document={result.document}
      scene={recursiveScene(result.document)}
      onError={jest.fn()}
    />,
  );
  const order = [
    ...container.querySelectorAll(
      '[data-name="connection-path"], [data-name="connection-label"]',
    ),
  ].map((node) => node.getAttribute('data-name'));
  expect(order.filter((name) => name === 'connection-label')).toHaveLength(2);
  expect(order.lastIndexOf('connection-path')).toBeLessThan(
    order.indexOf('connection-label'),
  );
});
