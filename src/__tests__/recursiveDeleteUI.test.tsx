import { fireEvent, render, screen } from '@testing-library/react';
import RecursiveDelete from '../renderer/components/RecursiveDelete';
import { recursiveFixture } from './recursiveFixtures';
import { transactDocument } from '../shared/documentTransactions';

it('keeps subtree deletion behind explicit confirmation and permits cancellation', () => {
  const document = recursiveFixture();
  const onEdit = jest.fn();
  const onBusyChange = jest.fn();
  render(
    <RecursiveDelete
      document={document}
      selection={['object-app']}
      point={null}
      blocked={() => false}
      onEdit={onEdit}
      onBusyChange={onBusyChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
    /3 objects, including 2 descendants \(1 hidden\)/,
  );
  expect(onEdit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onBusyChange).toHaveBeenLastCalledWith('delete-confirmation', false);
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete subtree' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  const result = transactDocument(document, onEdit.mock.calls[0][0]);
  expect(Object.keys(result.document.objects)).toEqual(['payments']);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('protects text/code/numeric editors, active gestures and dialogs while point deletion targets only the point', () => {
  const document = recursiveFixture();
  document.objects.api.boundaryPoints = { p: { side: 'left', offset: 0.5 } };
  const onEdit = jest.fn();
  let busy = false;
  render(
    <>
      <input aria-label="Number" type="number" />
      <textarea aria-label="Code" />
      <div contentEditable data-testid="rich" />
      <RecursiveDelete
        document={document}
        selection={['object-api']}
        point={{ objectId: 'api', pointId: 'p' }}
        blocked={() => busy}
        onEdit={onEdit}
        onBusyChange={() => {}}
      />
    </>,
  );
  for (const target of [
    screen.getByLabelText('Number'),
    screen.getByLabelText('Code'),
    screen.getByTestId('rich'),
  ])
    fireEvent.keyDown(target, { key: 'Backspace' });
  expect(onEdit).not.toHaveBeenCalled();
  busy = true;
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(onEdit).not.toHaveBeenCalled();
  busy = false;
  const dialog = window.document.createElement('dialog');
  dialog.open = true;
  window.document.body.append(dialog);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(onEdit).not.toHaveBeenCalled();
  dialog.remove();
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(onEdit).toHaveBeenCalledTimes(1);
  const result = transactDocument(document, onEdit.mock.calls[0][0]);
  expect(result.status).toBe('accepted');
  expect(result.document.objects.api).toBeDefined();
  expect(result.document.objects.api.boundaryPoints).toEqual({});
});
