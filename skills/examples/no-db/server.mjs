export function responseFor(path) {
  return path === '/health'
    ? { status: 200, body: { status: 'ok' } }
    : { status: 404, body: { error: 'not found' } };
}
