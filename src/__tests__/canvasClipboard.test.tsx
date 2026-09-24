import { act, renderHook, waitFor } from '@testing-library/react';
import useCanvasClipboard from '../renderer/hooks/useCanvasClipboard';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { editObject } from '../shared/documentTransactions';
import { copySelection } from '../shared/recursiveClipboard';

let text: string;
const writeText = jest.fn(async (value: string) => {
  text = value;
});
const readText = jest.fn(async () => text);
const onStatus = jest.fn();
beforeEach(() => {
  text = '';
  jest.clearAllMocks();
  window.desktop = { clipboard: { writeText, readText } } as any;
});
const key = (
  letter: string,
  modifier = 'ctrlKey',
  target: EventTarget = window,
) => {
  const event = new KeyboardEvent('keydown', {
    key: letter,
    [modifier]: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};
function setup() {
  return renderHook(() => {
    const state = useDocumentState(recursiveFixture());
    useCanvasClipboard({
      document: state.document!,
      selection: ['object-app'],
      isBusy: state.isBusy,
      onEdit: state.transact,
      onSelect: (ids) => state.setCanvas((c) => ({ ...c, selected: ids })),
      onStatus,
    });
    return state;
  });
}

it.each(['ctrlKey', 'metaKey'])(
  'copies a snapshot with %s and pastes fresh offset copies with one Undo step each',
  async (modifier) => {
    const { result } = setup();
    await act(async () => {
      key('c', modifier);
    });
    expect(result.current.past).toHaveLength(0);
    act(() => result.current.transact(editObject('app', { name: 'Changed' })));
    await act(async () => {
      key('v', modifier);
    });
    const first = result.current.canvas.selected[0].slice(7);
    expect(result.current.document!.objects[first].name).toBe('app');
    expect(result.current.document!.layouts[first][1][first]).toMatchObject({
      x: 424,
      y: 44,
    });
    await act(async () => {
      key('v', modifier);
    });
    const second = result.current.canvas.selected[0].slice(7);
    expect(second).not.toBe(first);
    expect(result.current.document!.layouts[second][1][second]).toMatchObject({
      x: 448,
      y: 68,
    });
    expect(result.current.past).toHaveLength(3);
    act(() => result.current.undo());
    expect(result.current.document!.objects[second]).toBeUndefined();
    expect(result.current.document!.objects[first]).toBeDefined();
    act(() => result.current.redo());
    expect(result.current.document!.objects[second]).toBeDefined();
  },
);

it('leaves text editors, dialogs, busy gestures, repeat and unrelated clipboard data alone', async () => {
  const { result } = setup();
  for (const element of [
    document.createElement('input'),
    document.createElement('textarea'),
    document.createElement('div'),
  ]) {
    element.setAttribute('contenteditable', 'true');
    document.body.append(element);
    expect(key('c', 'ctrlKey', element).defaultPrevented).toBe(false);
    expect(key('v', 'ctrlKey', element).defaultPrevented).toBe(false);
    element.remove();
  }
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  dialog.showModal();
  expect(key('v').defaultPrevented).toBe(false);
  dialog.remove();
  result.current.setBusy('gesture', true);
  expect(key('c').defaultPrevented).toBe(false);
  result.current.setBusy('gesture', false);
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, repeat: true }),
  );
  expect(readText).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  text = 'ordinary text';
  await act(async () => {
    key('v');
  });
  expect(result.current.past).toHaveLength(0);
});

it('handles native copy/paste events and cancels a pending paste when the document closes', async () => {
  const { result, unmount } = setup();
  const data = {
    setData: jest.fn((_type: string, value: string) => {
      text = value;
    }),
    getData: () => text,
  };
  const send = (type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    window.dispatchEvent(event);
  };
  await act(async () => {
    send('copy');
    send('paste');
  });
  expect(result.current.past).toHaveLength(1);
  expect(readText).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  let finish!: (value: string) => void;
  readText.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    key('v');
  });
  await waitFor(() => expect(readText).toHaveBeenCalled());
  unmount();
  await act(async () => {
    finish(text);
  });
  expect(result.current.past).toHaveLength(1);
});

it('recovers after a clipboard failure and serializes a quick copy then paste', async () => {
  const { result } = setup();
  readText.mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => {
    key('v');
  });
  expect(onStatus).toHaveBeenCalledWith('Could not paste: unavailable');
  text = copySelection(recursiveFixture(), ['object-payments']);
  await act(async () => {
    key('c');
    key('v');
  });
  expect(result.current.past).toHaveLength(1);
  expect(
    result.current.document!.objects[result.current.canvas.selected[0].slice(7)]
      .name,
  ).toBe('app');
});
