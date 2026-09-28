import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TemplateLibrary from '../renderer/components/TemplateLibrary';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { bundledTemplates } from '../shared/bundledTemplates';
import { newFromTemplate, type TemplateEntry } from '../shared/templates';

jest.mock('react-konva', () => ({
  Stage: () => <div />,
  Layer: () => <div />,
}));
jest.mock('../renderer/components/RecursiveScene', () => ({
  __esModule: true,
  default: () => <div />,
}));
const onOpen = jest.fn(),
  onClose = jest.fn();
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
  const owner = useDocumentState(newFromTemplate(bundledTemplates[0]));
  return (
    <>
      <span data-testid="object-count">
        {Object.keys(owner.document!.objects).length}
      </span>
      <TemplateLibrary
        owner={owner}
        onClose={onClose}
        onOpen={onOpen}
        onStatus={jest.fn()}
      />
    </>
  );
}
const start = async () => {
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByText('Import template')).toBeEnabled(),
  );
};
test('previews bundled/retained sources, inserts a component, and offers explicit reveal', async () => {
  await start();
  fireEvent.change(screen.getByLabelText('Reusable component'), {
    target: { value: 'customers' },
  });
  fireEvent.change(screen.getByLabelText('Preview view'), {
    target: { value: 'expanded' },
  });
  fireEvent.click(screen.getByText('Add component'));
  expect(screen.getByTestId('object-count')).toHaveTextContent('13');
  expect(screen.getByText('Reveal inserted item')).toBeEnabled();
  expect(onOpen).not.toHaveBeenCalled();
});
test('duplicate import reviews contents and creates a separate identity without overwrite', async () => {
  await start();
  fireEvent.click(screen.getByText('Import template'));
  await screen.findByRole('dialog', { name: 'Review template' });
  expect(screen.getByText(/A template with this ID/)).toBeVisible();
  fireEvent.click(screen.getByText('Import separate copy'));
  await screen.findByRole('dialog', { name: 'Templates' });
  expect(window.desktop.templates.save).toHaveBeenCalledTimes(1);
  const saved = entries[0].document.extensions.template;
  expect(saved.id).not.toBe('bundled-erd');
  expect(saved.version).toBe(1);
});
test('authors a personal template and reviews portable contents before writing', async () => {
  await start();
  fireEvent.click(screen.getByText('Create from document'));
  fireEvent.change(screen.getByLabelText('Template name'), {
    target: { value: 'My schema' },
  });
  fireEvent.change(screen.getByLabelText('How to add another item'), {
    target: { value: 'Add tables below the schema.' },
  });
  fireEvent.click(screen.getByText('Save personal copy'));
  expect(window.desktop.templates.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByLabelText('Template name')).toHaveValue('My schema');
  expect(screen.getByLabelText('How to add another item')).toHaveValue(
    'Add tables below the schema.',
  );
  fireEvent.click(screen.getByText('Save personal copy'));
  fireEvent.click(screen.getByText('Save to library'));
  await screen.findByRole('dialog', { name: 'Templates' });
  expect(entries[0].document.extensions.template.name).toBe('My schema');
  expect(entries[0].document.extensions.templateSources).toBeUndefined();
});
test('new and edit actions are handed to the guarded document transition', async () => {
  await start();
  fireEvent.click(screen.getByText('New from template'));
  expect(onOpen).toHaveBeenLastCalledWith(bundledTemplates[0], false);
  fireEvent.click(screen.getByText('Customize a copy'));
  expect(onOpen).toHaveBeenLastCalledWith(bundledTemplates[0], true);
});
