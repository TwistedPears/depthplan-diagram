import { fireEvent, render, screen } from '@testing-library/react';
import SelectionLink from '../renderer/components/SelectionLink';
import { recursiveFixture } from './recursiveFixtures';
import { transactDocument } from '../shared/documentTransactions';

it('validates, stores and clears an item link without changing rich text', () => {
  let document = recursiveFixture();
  const content = document.objects.api.content;
  const onClose = jest.fn();
  const view = render(
    <SelectionLink
      target="object-api"
      value=""
      onClose={onClose}
      onEdit={(edit) => {
        document = transactDocument(document, edit).document;
      }}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Item link URL' });
  fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
  expect(screen.getByRole('button', { name: 'Save link' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open link' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
  expect(document.objects.api.style?.link).toBe('https://example.com');
  expect(document.objects.api.content).toEqual(content);
  expect(onClose).toHaveBeenCalledTimes(1);
  view.unmount();
  render(
    <SelectionLink
      target="object-api"
      value="https://example.com"
      onClose={onClose}
      onEdit={(edit) => {
        document = transactDocument(document, edit).document;
      }}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Item link URL' }), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
  expect(document.objects.api.style?.link).toBeNull();
});
