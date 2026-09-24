import {
  createRecursiveDocument,
  type RecursiveDocument,
  type Geometry,
  type DiagramObject,
} from '../shared/recursiveDocument';
export const geometry: Geometry = {
  x: 10,
  y: 20,
  z: 0,
  width: 100,
  height: 60,
  rotation: 0,
};
export function recursiveFixture(): RecursiveDocument {
  const object = (id: string, parentId: string | null): DiagramObject => ({
    id,
    parentId,
    name: id,
    type: 'rectangle',
    geometry: { ...geometry },
    content: [{ type: 'paragraph', runs: [{ text: id }] }],
  });
  const objects = {
    app: object('app', null),
    api: object('api', 'app'),
    endpoint: object('endpoint', 'api'),
    payments: object('payments', null),
  };
  return {
    ...createRecursiveDocument('diagram', 'Fixture', '2026-09-18'),
    objects,
    rootDepths: { app: 1, payments: 0 },
    layouts: {
      app: {
        0: { app: { ...geometry } },
        1: { app: { ...geometry, x: 400 }, api: { ...geometry } },
        2: {
          app: { ...geometry, x: 500 },
          api: { ...geometry },
          endpoint: { ...geometry },
        },
      },
      payments: { 0: { payments: { ...geometry, x: 900 } } },
    },
    connections: {},
  };
}
