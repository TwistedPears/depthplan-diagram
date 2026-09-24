import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ShapeToolbar from '../renderer/components/ShapeToolbar';
import ObjectSearchResults from '../renderer/components/ObjectSearchResults';
import { ToolMode } from '../renderer/types/CanvasTools';
import { recursiveFixture } from './recursiveFixtures';

it('focuses the input, searches only on Enter, opens results and restores focus after closing', () => {
  const onFocus = jest.fn();
  const document = recursiveFixture();
  function Search() {
    const [query, setQuery] = useState<string | null>(null);
    return (
      <>
        <ShapeToolbar
          activeTool={ToolMode.POINTER}
          onChangeTool={() => {}}
          onSearch={setQuery}
        />
        {query !== null && (
          <ObjectSearchResults
            document={document}
            query={query}
            onFocus={onFocus}
            onClose={() => setQuery(null)}
          />
        )}
      </>
    );
  }
  render(<Search />);
  const toggle = screen.getByRole('button', { name: 'Search objects' });
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  const input = screen.getByRole('searchbox');
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'endpoint' } });
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.submit(screen.getByRole('search'));
  const panel = screen.getByRole('complementary', { name: 'Search Results' });
  expect(within(panel).getByRole('status')).toHaveTextContent('1 object found');
  fireEvent.click(
    within(panel).getByRole('button', { name: 'endpoint endpoint' }),
  );
  expect(onFocus).toHaveBeenCalledWith('endpoint');
  fireEvent.click(screen.getByRole('button', { name: 'Close search results' }));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'missing' } });
  fireEvent.submit(screen.getByRole('search'));
  expect(screen.getByRole('status')).toHaveTextContent('No matching objects.');
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.submit(screen.getByRole('search'));
  expect(screen.getByRole('status')).toHaveTextContent('Enter text to search.');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(toggle).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Close search results' }));
  expect(toggle).toHaveFocus();
});
