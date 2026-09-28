import { fireEvent, render, screen } from '@testing-library/react';
import SelectionMenu from '../renderer/components/SelectionMenu';

test('menu navigation skips unavailable actions, dismisses with Escape and restores focus', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const action = jest.fn(),
    onClose = jest.fn();
  const { unmount } = render(
    <SelectionMenu
      x={10000}
      y={10000}
      onClose={onClose}
      groups={[
        [
          { label: 'Copy', action },
          { label: 'Paste styles', disabled: true, action },
          { label: 'Save Template', action },
        ],
      ]}
    />,
  );
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Save Template' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(onClose).toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  unmount();
  trigger.remove();
});
