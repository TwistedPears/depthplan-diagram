import './desktop';
import { createRoot } from 'react-dom/client';
import App from './App';

const icons = import.meta.glob<string>('./assets/icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const sprite = Object.entries(icons)
  .map(([path, svg]) => {
    const name = path.split('/').at(-1)!.slice(0, -4);
    return svg
      .replace('<svg ', `<symbol id="icon-${name}" overflow="visible" `)
      .replace('</svg>', '</symbol>');
  })
  .join('');

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(
  <>
    {/* Trusted, checked-in SVG only; never document or user-provided markup. */}
    <svg
      style={{ display: 'none' }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: sprite }}
    />
    <App />
  </>,
);
