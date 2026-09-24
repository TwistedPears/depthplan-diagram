import { useMemo } from 'react';
import Icon from './Icon';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import { searchObjects } from '../../shared/objectSearch';

export default function ObjectSearchResults({
  document,
  query,
  onFocus,
  onClose,
}: {
  document: RecursiveDocument;
  query: string;
  onFocus: (id: string) => void;
  onClose: () => void;
}) {
  const results = useMemo(
    () => searchObjects(document, query),
    [document, query],
  );
  return (
    <aside
      className="object-search-results"
      aria-labelledby="object-search-heading"
    >
      <div className="selection-heading">
        <h2 id="object-search-heading">Search Results</h2>
        <button
          type="button"
          className="selection-collapse"
          aria-label="Close search results"
          title="Close search results"
          onClick={() => {
            onClose();
            const input = window.document.getElementById('object-search-input');
            const form = window.document.getElementById('object-search-form');
            (form && !form.hidden
              ? input
              : window.document.getElementById('object-search-toggle')
            )?.focus();
          }}
        >
          <Icon name="xmark" />
        </button>
      </div>
      <p className="search-summary" role="status">
        {!query
          ? 'Enter text to search.'
          : results.length
            ? `${results.length} ${results.length === 1 ? 'object' : 'objects'} found`
            : 'No matching objects.'}
      </p>
      {results.length > 0 && (
        <ul>
          {results.map((result) => (
            <li key={result.id}>
              <button type="button" onClick={() => onFocus(result.id)}>
                <strong>{result.label}</strong>
                {result.text && <span>{result.text}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
