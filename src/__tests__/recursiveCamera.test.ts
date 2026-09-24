import { recursiveFixture } from './recursiveFixtures';
import {
  sceneBounds,
  viewportBounds,
  intersectsBounds,
  fitCamera,
  zoomCamera,
  geometryBounds,
} from '../shared/recursiveCamera';
it('bounds use current-depth world geometry, rotation and visible overflow, excluding hidden descendants', () => {
  const d = recursiveFixture();
  d.layouts.app[1].api.x = -800;
  d.layouts.app[1].api.rotation = 90;
  d.layouts.app[2].endpoint.x = 1e7;
  const original = JSON.stringify(d);
  const bounds = sceneBounds(d);
  expect(bounds.objects.has('endpoint')).toBe(false);
  expect(bounds.objects.get('api')!.x).toBeCloseTo(-430.75);
  expect(bounds.bounds!.width).toBeGreaterThan(1300);
  fitCamera(bounds.bounds, { width: 1000, height: 600 });
  expect(JSON.stringify(d)).toBe(original);
  d.objects.app.style = { clipToFrame: true };
  expect(sceneBounds(d).objects.has('api')).toBe(false);
});
it('fit includes far-apart negative/positive roots without a minimum-zoom cutoff', () => {
  const d = recursiveFixture();
  d.layouts.payments[0].payments.x = 1e7;
  d.layouts.app[1].app.x = -1e7;
  const b = sceneBounds(d).bounds!;
  const camera = fitCamera(b, { width: 1000, height: 600 });
  expect(camera.scale).toBeLessThan(0.25);
  expect(camera.x + b.x * camera.scale).toBeCloseTo(80);
  expect(camera.x + (b.x + b.width) * camera.scale).toBeCloseTo(920);
  expect(fitCamera(null, { width: 1000, height: 600 })).toEqual({
    x: 500,
    y: 300,
    scale: 1,
  });
});
it('pointer zoom preserves the world point under the cursor through repeated zooms', () => {
  const point = { x: 420, y: 180 },
    camera = { x: -200, y: 600, scale: 0.05 };
  let next = camera;
  for (const scale of [2, 0.25, 0.001, 0.05])
    next = zoomCamera(next, point, scale);
  expect(next.x).toBeCloseTo(camera.x);
  expect(next.y).toBeCloseTo(camera.y);
  expect(
    geometryBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90, z: 0 }),
  ).toMatchObject({ width: expect.closeTo(50), height: expect.closeTo(100) });
});

it('inverse-transforms the complete viewport and conservatively retains crossing bounds', () => {
  const box = viewportBounds(
    { x: -200, y: 100, scale: 0.5 },
    { width: 800, height: 600 },
  );
  expect(box).toEqual({ x: 396, y: -204, width: 1608, height: 1208 });
  expect(
    intersectsBounds({ x: -1000, y: 200, width: 5000, height: 0 }, box),
  ).toBe(true);
  expect(intersectsBounds({ x: 2004, y: 0, width: 10, height: 10 }, box)).toBe(
    true,
  );
  expect(intersectsBounds({ x: 2005, y: 0, width: 10, height: 10 }, box)).toBe(
    false,
  );
  expect(intersectsBounds({ x: 500, y: 0, width: -1, height: 10 }, box)).toBe(
    false,
  );
});
