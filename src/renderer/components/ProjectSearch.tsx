import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { searchItems } from '../../shared/editorQueries';
import type { ProjectManifest } from '../../shared/projectContract';
import useDocumentSessions from '../hooks/useDocumentSessions';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import FormDialog from './FormDialog';

type Hit =
  ReturnType<typeof searchItems> extends Generator<{ item: infer I }>
    ? I
    : never;
type Group = {
  board: ProjectManifest['boards'][number];
  items: Hit[];
  version: { sessionId: string; revision: number } | { fingerprint: string };
};
const labels = {
  objects: 'Object',
  connections: 'Connection',
  bookmarks: 'Bookmark',
};

export default function ProjectSearch() {
  const workspace = useProjectWorkspace()!;
  const registry = useDocumentSessions();
  const current = useRef(workspace);
  current.current = workspace;
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const searched = useRef({ sessionId: '', fingerprint: '' });
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [status, setStatus] = useState(
    'Enter text to search all boards, including hidden content.',
  );
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const stop = () => {
    generation.current++;
    setSearching(false);
    setStatus(
      'Search stopped. These are partial results; search again to continue.',
    );
  };
  const search = async () => {
    const project = current.current.project;
    if (!project || !query.trim()) return;
    const run = ++generation.current;
    searched.current = project;
    setGroups([]);
    setFailures([]);
    setError('');
    setSearching(true);
    const found: Group[] = [],
      failed: string[] = [];
    let count = 0,
      scanned = 0;
    const summary = () =>
      `${count} results · ${scanned} of ${project.manifest.boards.length} boards searched`;
    const valid = () => generation.current === run;
    try {
      for (const board of project.manifest.boards) {
        if (!valid()) return;
        if (
          current.current.project?.sessionId !== project.sessionId ||
          current.current.project.fingerprint !== project.fingerprint
        )
          throw new Error('Project membership changed. Search again.');
        try {
          const owner = registry.controllers.get(
            `${project.sessionId}:${board.id}`,
          )?.owner;
          const snapshot = owner?.snapshot();
          const disk = snapshot
            ? null
            : await window.desktop.projects.readBoard(
                project.sessionId,
                board.id,
              );
          if (!valid()) return;
          if (disk && disk.status !== 'success')
            throw new Error(
              disk.status === 'error' ? disk.error : 'Read canceled',
            );
          const document =
            snapshot?.document ??
            (disk?.status === 'success' ? disk.board.document : null);
          if (!document) throw new Error('No board content available');
          const version = snapshot
            ? { sessionId: snapshot.sessionId, revision: snapshot.revision }
            : {
                fingerprint:
                  disk!.status === 'success' ? disk!.board.fingerprint : '',
              };
          const items: Hit[] = [];
          for (const { item } of searchItems(document, { query })) {
            items.push(item);
            if (++count === 500) break;
          }
          if (items.length) found.push({ board, items, version });
        } catch (e) {
          failed.push(`${board.name} (${board.path}): ${String(e)}`);
        }
        scanned++;
        setGroups([...found]);
        setFailures([...failed]);
        setStatus(`Searching… ${summary()}`);
        // ponytail: one validated board per turn; add a worker only if single-board scans exceed the interaction budget.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (count === 500) break;
      }
      if (valid())
        setStatus(
          `${summary()}. ${count === 500 ? 'Stopped at 500 results; refine your search.' : failed.length ? 'Partial results: some boards could not be read.' : 'Search complete.'}`,
        );
    } catch (e) {
      if (valid()) {
        setError(String(e));
        setStatus(`${summary()}. Search stopped; results may be stale.`);
      }
    } finally {
      if (valid()) setSearching(false);
    }
  };
  const open = async (group: Group, hit: Hit) => {
    setError('');
    const opened = await workspace.run(async () => {
      try {
        const project = current.current.project;
        if (
          !project ||
          project.sessionId !== searched.current.sessionId ||
          project.fingerprint !== searched.current.fingerprint
        )
          throw new Error('Project changed. Search again.');
        const key = `${project.sessionId}:${group.board.id}`;
        const matches = () => {
          const snapshot = registry.controllers.get(key)?.owner.snapshot();
          return (
            snapshot &&
            ('sessionId' in group.version
              ? snapshot.sessionId === group.version.sessionId &&
                snapshot.revision === group.version.revision
              : !snapshot.dirty &&
                (snapshot.source?.fingerprint ??
                  registry
                    .snapshot()
                    .sessions.find((session) => session.key === key)
                    ?.fingerprint) === group.version.fingerprint)
          );
        };
        if (registry.controllers.has(key) && !matches())
          throw new Error('Board changed since this search. Search again.');
        if ('sessionId' in group.version && !registry.controllers.has(key))
          throw new Error('Board was closed since this search. Search again.');
        if (!(await workspace.openBoard(group.board.id))) return false;
        if (!matches())
          throw new Error('Board changed since this search. Search again.');
        registry.controllers
          .get(key)!
          .owner.focusEntity(hit.collection, hit.id);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    });
    if (opened) {
      flushSync(() => workspace.setDialog(null));
      document.getElementById(`board-${group.board.id}`)?.focus();
    }
  };
  return (
    <FormDialog
      title="Search Project"
      description="Search object names and content, connection labels and bookmarks across every board. Open a result to reveal it."
      initialFocus={input}
      onCancel={() => {
        generation.current++;
        workspace.setDialog(null);
      }}
      cancelDisabled={workspace.busy}
      cancelLabel="Close"
      onSubmit={() => {
        void search();
      }}
      submitLabel="Search"
      submitDisabled={!query.trim() || searching || workspace.busy}
      actions={
        searching && (
          <button type="button" onClick={stop}>
            Stop search
          </button>
        )
      }
    >
      <label className="form-dialog-field">
        Search content
        <input
          ref={input}
          type="search"
          maxLength={1024}
          value={query}
          onChange={(e) => {
            generation.current++;
            setSearching(false);
            setGroups([]);
            setFailures([]);
            setError('');
            setQuery(e.target.value);
            setStatus('Press Search to find matching content.');
          }}
        />
      </label>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <p role="alert" className="project-error">
          {error}
        </p>
      )}
      {groups.map((group) => (
        <section
          className="form-dialog-section"
          key={group.board.id}
          aria-label={`${group.board.name}, ${group.board.path}`}
        >
          <h3>{group.board.name}</h3>
          <p className="field-hint">{group.board.path}</p>
          <ul className="project-search-results">
            {group.items.map((hit) => (
              <li key={`${hit.collection}:${hit.id}`}>
                <button
                  type="button"
                  disabled={searching || workspace.busy}
                  onClick={() => {
                    void open(group, hit);
                  }}
                >
                  <strong>
                    {labels[hit.collection]} · {hit.label || hit.id}
                  </strong>
                  <span>{hit.snippet}</span>
                  <small>
                    {hit.visible === false ? 'Hidden · ' : ''}
                    {hit.id}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!!failures.length && (
        <section className="form-dialog-section" aria-label="Unreadable boards">
          <h3>{failures.length} boards unavailable</h3>
          {failures.slice(0, 20).map((failure) => (
            <p className="project-error" key={failure}>
              {failure}
            </p>
          ))}
          {failures.length > 20 && <p>Only the first 20 errors are shown.</p>}
        </section>
      )}
    </FormDialog>
  );
}
