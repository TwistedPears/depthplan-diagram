import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TemplateLibrary from '../renderer/components/TemplateLibrary';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { bundledTemplates } from '../shared/bundledTemplates';
import { type TemplateEntry } from '../shared/templates';
import { recursiveFixture } from './recursiveFixtures';

jest.mock('react-konva', () => ({
  Stage: () => <div />,
  Layer: () => <div />,
}));
jest.mock('../renderer/components/RecursiveScene', () => ({
  __esModule: true,
  default: () => <div />,
}));
const onClose = jest.fn();
let entries: TemplateEntry[];
beforeEach(() => {
  entries = [];
  jest.clearAllMocks();
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  Object.assign(window, {
    desktop: {
      templates: {
        list: jest.fn(async () => ({ entries, warnings: [] })),
        import: jest.fn(async () => ({
          document: bundledTemplates[0],
          fingerprint: 'external',
        })),
        export: jest.fn(async () => '/tmp/template.depthtemplate'),
        save: jest.fn(async (document) => {
          const entry = { document, fingerprint: 'saved' };
          entries.push(entry);
          return entry;
        }),
        remove: jest.fn(async () => {
          entries = [];
        }),
      },
    },
  });
});
function Harness() {
  const owner = useDocumentState(recursiveFixture(), 'app', {
    source: {
      id: 'file',
      path: '/tmp/existing.depthplan',
      fingerprint: 'original',
    },
  });
  const [open, setOpen] = useState(true);
  return (
    <>
      <output data-testid="document">{JSON.stringify(owner.document)}</output>
      <output data-testid="source">{JSON.stringify(owner.source)}</output>
      <output data-testid="selection">
        {JSON.stringify(owner.canvas.selected)}
      </output>
      <button type="button" onClick={owner.undo}>
        Undo
      </button>
      <button type="button" onClick={owner.redo}>
        Redo
      </button>
      {open && (
        <TemplateLibrary
          owner={owner}
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          onStatus={jest.fn()}
        />
      )}
    </>
  );
}
const start = async () => {
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByText('Import template')).toBeEnabled(),
  );
};
test('gallery filters, previews, inserts on the same board and supports one-step Undo/Redo', async () => {
  await start();
  const before = screen.getByTestId('document').textContent!;
  const source = screen.getByTestId('source').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Infrastructure' }));
  expect(
    screen.queryByRole('button', { name: 'Preview ERD · database schema' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All templates' }));
  fireEvent.change(screen.getByLabelText('Search templates'), {
    target: { value: 'Data modelling' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview ERD · database schema' }),
  );
  expect(screen.queryByText('New from template')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Insert template' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const after = JSON.parse(screen.getByTestId('document').textContent!);
  expect(after.id).toBe(JSON.parse(before).id);
  expect(after.objects).toMatchObject(JSON.parse(before).objects);
  expect(Object.keys(after.objects)).toHaveLength(
    Object.keys(JSON.parse(before).objects).length + 9,
  );
  expect(after.extensions?.templateSources).toBeUndefined();
  expect(screen.getByTestId('source').textContent).toBe(source);
  expect(JSON.parse(screen.getByTestId('selection').textContent!)).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByText('Undo'));
  expect(screen.getByTestId('document').textContent).toBe(before);
  fireEvent.click(screen.getByText('Redo'));
  expect(JSON.parse(screen.getByTestId('document').textContent!)).toEqual(
    after,
  );
});
test('empty searches and an empty personal library have useful states', async () => {
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'My templates' }));
  expect(screen.getByText('No templates yet')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Search templates'), {
    target: { value: 'nonexistent' },
  });
  expect(screen.getByText('No matching templates')).toBeVisible();
});
test('duplicate import reviews contents and creates a separate identity without overwrite', async () => {
  await start();
  fireEvent.click(screen.getByText('Import template'));
  await screen.findByRole('dialog', { name: 'Review template' });
  expect(screen.getByText(/A template with this ID/)).toBeVisible();
  fireEvent.click(screen.getByText('Import separate copy'));
  await screen.findByRole('dialog', { name: 'Templates' });
  expect(window.desktop.templates.save).toHaveBeenCalledTimes(1);
  expect(entries[0].document.extensions.template.id).not.toBe('bundled-erd');
  expect(entries[0].document.extensions.template.version).toBe(1);
});
test('saves a personal example with no reusable-component setup and retains the draft after review cancellation', async () => {
  await start();
  fireEvent.click(screen.getByText('Save board as template'));
  fireEvent.change(screen.getByLabelText('Template name'), {
    target: { value: 'My schema' },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'A starting point' },
  });
  fireEvent.click(screen.getByText('Review template'));
  expect(window.desktop.templates.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByLabelText('Template name')).toHaveValue('My schema');
  expect(screen.getByLabelText('Description')).toHaveValue('A starting point');
  fireEvent.click(screen.getByText('Review template'));
  fireEvent.click(screen.getByText('Save to library'));
  await screen.findByRole('dialog', { name: 'Templates' });
  expect(entries[0].document.extensions.template.name).toBe('My schema');
  expect(entries[0].document.extensions.template.components).toEqual([]);
  expect(entries[0].document.extensions.templateSources).toBeUndefined();
});
test('library loading failures leave the built-in gallery usable', async () => {
  jest
    .mocked(window.desktop.templates.list)
    .mockRejectedValueOnce(new Error('Library unavailable'));
  await start();
  expect(screen.getByRole('alert')).toHaveTextContent('Library unavailable');
  fireEvent.click(
    screen.getByRole('button', { name: 'Insert ERD · database schema' }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});
