import { StrictMode } from 'react';
import type { DocumentEdit } from '../shared/documentTransactions';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { recursiveFixture } from './recursiveFixtures';
import {
  createRecursiveDocument,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import App from '../renderer/App';

// Canvas rendering is exercised in the Tauri smoke check. This boundary test
// verifies the application menu/file flow without a native canvas dependency.
jest.mock('../renderer/components/RecursiveCanvas', () => ({
  __esModule: true,
  default: ({
    document,
    onEdit,
  }: {
    document: RecursiveDocument;
    onEdit: (edit: DocumentEdit) => void;
  }) => (
    <div data-testid="recursive-canvas" data-document-id={document.id}>
      <button
        onClick={() =>
          onEdit((draft) => {
            draft.metadata.title = 'Startup edit';
          })
        }
      >
        Edit document
      </button>
    </div>
  ),
}));

const chooseFileCommand = (name: string) => {
  fireEvent.click(screen.getByTitle('Menu'));
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('App', () => {
  const listeners = new Map<string, () => void>();
  beforeEach(() => {
    listeners.clear();
    window.desktop = {
      recovery: {
        discover: jest.fn().mockResolvedValue({ entries: [], warnings: [] }),
        write: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      },
      automation: {
        status: jest.fn().mockResolvedValue({
          enabled: false,
          descriptor: '',
          executable: '',
          adapter: '',
        }),
        onRequest: jest.fn(() => () => {}),
        enable: jest.fn(),
      },
      getAppInstanceId: jest.fn().mockResolvedValue('application-instance'),
      events: {
        on: jest.fn((channel: string, listener: () => void) => {
          listeners.set(channel, listener);
          return () => listeners.delete(channel);
        }),
      },
      transitions: {
        confirm: jest.fn().mockResolvedValue('discard'),
        onRequest: jest.fn(() => () => {}),
        reply: jest.fn(),
      },
      fileSystem: {
        newDocument: jest.fn().mockResolvedValue({
          document: createRecursiveDocument('test-document', 'Test diagram'),
          filePath: null,
        }),
        openDocument: jest.fn().mockResolvedValue({ status: 'canceled' }),
        saveDocument: jest.fn().mockResolvedValue({
          status: 'success',
          source: {
            id: 'saved',
            path: '/tmp/test.depthplan.json',
            fingerprint: 'saved-hash',
          },
        }),
      },
    } as unknown as typeof window.desktop;
  });

  it('starts with a clean untitled document and saves without selecting New', async () => {
    render(<App />);
    expect(screen.getByText('Untitled Document')).toBeInTheDocument();
    expect(screen.getByText('New document')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    expect(window.desktop.fileSystem.newDocument).not.toHaveBeenCalled();
    expect(window.desktop.fileSystem.saveDocument).not.toHaveBeenCalled();
    chooseFileCommand('Save');
    await waitFor(() =>
      expect(window.desktop.fileSystem.saveDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          formatVersion: 2,
          metadata: expect.objectContaining({ title: 'Untitled Document' }),
          objects: {},
          connections: {},
          layouts: {},
          rootDepths: {},
        }),
        undefined,
      ),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('retains startup edits through identity loading, rerenders and a canceled first save', async () => {
    let finishIdentity!: (id: string) => void;
    const identity = new Promise<string>((resolve) => {
      finishIdentity = resolve;
    });
    (window.desktop.getAppInstanceId as jest.Mock).mockReturnValue(identity);
    (window.desktop.fileSystem.saveDocument as jest.Mock).mockResolvedValueOnce(
      {
        status: 'canceled',
      },
    );
    const { rerender } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const id = screen.getByTestId('recursive-canvas').dataset.documentId;
    expect(id).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit document' }));
    await act(async () => finishIdentity('application-instance'));
    rerender(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByText('Startup edit')).toBeInTheDocument();
    expect(screen.getByTestId('recursive-canvas')).toHaveAttribute(
      'data-document-id',
      id,
    );
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    chooseFileCommand('Save');
    await screen.findByText('Save canceled');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    chooseFileCommand('Save');
    await screen.findByText('Saved');
    expect(window.desktop.fileSystem.saveDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id,
        metadata: expect.objectContaining({ title: 'Startup edit' }),
      }),
      undefined,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Untitled Document')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it.each([false, true])(
    'guards closing the startup document only when edited=%s',
    async (edited) => {
      (window.desktop.transitions.confirm as jest.Mock).mockResolvedValue(
        'cancel',
      );
      render(<App />);
      if (edited)
        fireEvent.click(screen.getByRole('button', { name: 'Edit document' }));
      await act(async () => {
        const onClose = (
          window.desktop.transitions.onRequest as jest.Mock
        ).mock.calls.at(-1)[0];
        onClose('close-startup');
      });
      await waitFor(() =>
        expect(window.desktop.transitions.reply).toHaveBeenCalledWith(
          'close-startup',
          !edited,
        ),
      );
      expect(window.desktop.transitions.confirm).toHaveBeenCalledTimes(
        edited ? 1 : 0,
      );
      expect(window.desktop.fileSystem.saveDocument).not.toHaveBeenCalled();
    },
  );

  it('preserves the current document when opening is canceled', async () => {
    render(<App />);
    const id = screen.getByTestId('recursive-canvas').dataset.documentId;
    chooseFileCommand('Open');
    await waitFor(() =>
      expect(window.desktop.fileSystem.openDocument).toHaveBeenCalled(),
    );
    expect(screen.getByText('Untitled Document')).toBeInTheDocument();
    expect(screen.getByTestId('recursive-canvas')).toHaveAttribute(
      'data-document-id',
      id,
    );
  });

  it('restores recovered work over the clean startup document without a discard prompt', async () => {
    const document = recursiveFixture();
    (window.desktop.recovery.discover as jest.Mock).mockResolvedValue({
      entries: [
        {
          id: 'recovery-entry',
          title: 'Recovered diagram',
          capturedAt: new Date().toISOString(),
        },
      ],
      warnings: [],
    });
    window.desktop.recovery.prepare = jest.fn().mockResolvedValue({
      document,
      source: null,
      sessionId: 'restored-session',
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await screen.findByText('Fixture');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('closes recovery only after the final entry is successfully discarded', async () => {
    (window.desktop.recovery.discover as jest.Mock).mockResolvedValue({
      entries: ['first', 'last'].map((id) => ({
        id,
        title: `Recovered ${id}`,
        capturedAt: new Date().toISOString(),
      })),
      warnings: [],
    });
    const discard = jest.fn().mockResolvedValue(undefined);
    window.desktop.recovery.discard = discard;
    render(<App />);
    const dialog = await screen.findByRole('dialog', {
      name: 'Recover unsaved work',
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard' })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Discard' })).toHaveLength(
        1,
      ),
    );
    expect(discard).toHaveBeenLastCalledWith('first');
    expect(dialog).toBeVisible();

    discard.mockRejectedValueOnce(new Error('Could not discard checkpoint'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await screen.findByText(/Could not discard checkpoint/);
    expect(dialog).toBeVisible();
    expect(screen.getByText('Recovered last')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(dialog).not.toBeVisible());
    expect(discard).toHaveBeenLastCalledWith('last');
    expect(
      screen.queryByRole('button', { name: 'Continue without restoring' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Recovery/ })).toBeNull();
    expect(screen.getByText('Untitled Document')).toBeInTheDocument();
    expect(window.desktop.fileSystem.saveDocument).not.toHaveBeenCalled();
  });

  it('keeps current work when an unsupported document is opened', async () => {
    (window.desktop.fileSystem.openDocument as jest.Mock).mockResolvedValue({
      status: 'success',
      document: {
        metadata: { title: 'Old diagram' },
        canvas: {},
        blocks: {},
        connections: {},
      },
      source: { id: 'old', path: '/old.json', fingerprint: 'old' },
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit document' }));
    const id = screen.getByTestId('recursive-canvas').dataset.documentId;
    chooseFileCommand('Open');
    expect(
      await screen.findByText(
        /Failed to open document:.*unsupported document format/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('recursive-canvas')).toHaveAttribute(
      'data-document-id',
      id,
    );
    expect(screen.getByText('Startup edit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
  });
  it('opens v2 through the recursive canvas and saves the same canonical data', async () => {
    const document = recursiveFixture();
    (window.desktop.fileSystem.openDocument as jest.Mock).mockResolvedValue({
      status: 'success',
      document,

      source: {
        id: 'v2-source',
        path: '/tmp/v2.json',
        fingerprint: 'original',
      },
    });
    render(<App />);
    chooseFileCommand('Open');
    await screen.findByText('Fixture');
    chooseFileCommand('Save');
    await waitFor(() =>
      expect(window.desktop.fileSystem.saveDocument).toHaveBeenCalledWith(
        document,
        'v2-source',
      ),
    );
    chooseFileCommand('New');
    await screen.findByText('Test diagram');
  });
});
