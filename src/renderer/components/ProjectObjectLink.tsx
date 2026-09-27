import { useEffect, useRef, useState } from 'react';
import type {
  DiagramObject,
  ProjectLink,
} from '../../shared/recursiveDocument';
import type {
  DocumentEdit,
  TransactionResult,
} from '../../shared/documentTransactions';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import useDocumentDraft from '../hooks/useDocumentDraft';
import FormDialog from './FormDialog';
import Icon from './Icon';

type Props = {
  object: DiagramObject;
  onEdit: (edit: DocumentEdit) => TransactionResult | null;
  isBusy: () => boolean;
};
function LinkPicker({
  object,
  onEdit,
  isBusy,
  onClose,
}: Props & { onClose: () => void }) {
  const workspace = useProjectWorkspace();
  const project = workspace?.project;
  const original = object.projectLink;
  const session = useRef(project?.sessionId);
  const input = useRef<HTMLSelectElement>(null);
  const reader = useRef(workspace);
  reader.current = workspace;
  const [boardId, setBoardId] = useState(
    original?.projectId === project?.manifest.id
      ? (original?.boardId ?? '')
      : '',
  );
  const [bookmarkId, setBookmarkId] = useState(original?.bookmarkId ?? '');
  const [bookmarks, setBookmarks] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    let canceled = false;
    setBookmarks([]);
    setError('');
    setLoading(false);
    setLoaded('');
    if (!boardId || !reader.current?.project) return;
    setLoading(true);
    void reader.current
      .boardDocument(boardId)
      .then((document) => {
        if (!canceled) {
          setBookmarks(
            Object.values(document.namedViews ?? {}).map(({ id, name }) => ({
              id,
              name,
            })),
          );
          setLoaded(boardId);
        }
      })
      .catch((e) => {
        if (!canceled) setError(String(e));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [boardId, project?.sessionId]);
  const valid =
    !!project &&
    project.sessionId === session.current &&
    !loading &&
    loaded === boardId &&
    project.manifest.boards.some((board) => board.id === boardId) &&
    (!bookmarkId || bookmarks.some((view) => view.id === bookmarkId));
  const commit = (link?: ProjectLink) => {
    if (isBusy()) {
      setError('Finish the current edit or gesture first.');
      return;
    }
    const result = onEdit((draft) => {
      const target = draft.objects[object.id];
      if (!target) throw new Error('The source object no longer exists.');
      if (link) target.projectLink = link;
      else delete target.projectLink;
    });
    if (result?.status === 'rejected') setError(result.error);
    else onClose();
  };
  const apply = () => {
    if (!valid) {
      setError('Choose an available board and bookmark.');
      return;
    }
    commit({
      projectId: project!.manifest.id,
      boardId,
      ...(bookmarkId ? { bookmarkId } : {}),
    });
  };
  useDocumentDraft({
    label: 'project link target',
    active: () => true,
    canSuspend: () => false,
    apply,
    discard: onClose,
  });
  return (
    <FormDialog
      title={original ? 'Change project link' : 'Add project link'}
      description="Link this object to a board or bookmark in the current project. Targets use stable identities."
      initialFocus={input}
      onCancel={onClose}
      onSubmit={apply}
      submitLabel="Save link"
      submitDisabled={!valid}
      actions={
        original && (
          <button type="button" onClick={() => commit()}>
            Remove link
          </button>
        )
      }
    >
      {!project && (
        <p role="status">
          This board is open standalone. Open its project to follow or change
          the target. You can remove the reference here.
        </p>
      )}
      {!!project && original && original.projectId !== project.manifest.id && (
        <p role="status">
          This reference belongs to another project. Choose a target here to
          repair it.
        </p>
      )}
      <label className="form-dialog-field">
        <span>Board</span>
        <select
          ref={input}
          aria-label="Target board"
          value={boardId}
          disabled={!project}
          onChange={(e) => {
            setBoardId(e.target.value);
            setBookmarkId('');
            setError('');
          }}
        >
          <option value="">Choose a board</option>
          {boardId &&
            !project?.manifest.boards.some((board) => board.id === boardId) && (
              <option value={boardId}>Unavailable board ({boardId})</option>
            )}
          {project?.manifest.boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name} — {board.path}
            </option>
          ))}
        </select>
      </label>
      <label className="form-dialog-field">
        <span>Bookmark</span>
        <select
          aria-label="Target bookmark"
          value={bookmarkId}
          disabled={!boardId || loading || !project}
          onChange={(e) => {
            setBookmarkId(e.target.value);
            setError('');
          }}
        >
          <option value="">Board's current view</option>
          {bookmarkId && !bookmarks.some((view) => view.id === bookmarkId) && (
            <option value={bookmarkId}>
              Unavailable bookmark ({bookmarkId})
            </option>
          )}
          {bookmarks.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name} — {view.id}
            </option>
          ))}
        </select>
      </label>
      {loading && <p role="status">Reading bookmarks…</p>}
      {original && (
        <p className="field-hint">
          Reference: {original.projectId} / {original.boardId}
          {original.bookmarkId ? ` / ${original.bookmarkId}` : ''}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </FormDialog>
  );
}
export default function ProjectObjectLink(props: Props) {
  const workspace = useProjectWorkspace();
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const link = props.object.projectLink;
  if (!workspace?.project && !link) return null;
  const member =
    link?.projectId === workspace?.project?.manifest.id
      ? workspace?.project?.manifest.boards.find(
          (board) => board.id === link?.boardId,
        )
      : undefined;
  const unresolved = !!link && !member;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={link ? 'Change project link' : 'Add project link'}
        title={link ? 'Change project link' : 'Add project link'}
        onClick={() => {
          if (!props.isBusy()) setEditing(true);
        }}
      >
        <Icon name="link" />
      </button>
      {link && (
        <button
          type="button"
          className="project-link-open"
          aria-label="Open project link"
          title={
            unresolved
              ? 'Project link unavailable — change its target'
              : `Open ${member!.name}${link.bookmarkId ? ' bookmark' : ''}`
          }
          disabled={unresolved || workspace?.busy}
          onClick={() => {
            if (!props.isBusy()) void workspace?.followLink(link);
          }}
        >
          Open link
        </button>
      )}
      {unresolved && (
        <span role="status">Project link unavailable. Change its target.</span>
      )}
      {editing && (
        <LinkPicker
          {...props}
          onClose={() => {
            setEditing(false);
            requestAnimationFrame(() =>
              (
                trigger.current ?? document.getElementById('selection-controls')
              )?.focus(),
            );
          }}
        />
      )}
    </>
  );
}
