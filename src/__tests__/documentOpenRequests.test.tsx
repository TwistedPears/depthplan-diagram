import { act, renderHook, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import useDocumentOpenRequests from '../renderer/hooks/useDocumentOpenRequests';

it('claims each native request once across rerenders and drains pending requests after release', async () => {
  let receive!: (id: string) => void;
  let finish!: () => void;
  const errors = jest.fn();
  const open = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  window.desktop = {
    fileSystem: {
      onOpenRequested: (listener: typeof receive) => {
        receive = listener;
        return () => {};
      },
      releaseOpenRequest: jest.fn(async () => {
        flushSync(() => rerender());
      }),
    },
  } as unknown as typeof window.desktop;
  const { rerender } = renderHook(() =>
    useDocumentOpenRequests(false, open, errors),
  );
  act(() => {
    receive('a');
    receive('a');
  });
  expect(open).toHaveBeenCalledTimes(1);
  act(() => {
    receive('a');
    receive('b');
    rerender();
  });
  await act(async () => finish());
  await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  expect(open.mock.calls).toEqual([['a'], ['b']]);
  await act(async () => finish());
  act(() => rerender());
  expect(open).toHaveBeenCalledTimes(2);
  expect(window.desktop.fileSystem.releaseOpenRequest).toHaveBeenCalledTimes(2);
  expect(errors).not.toHaveBeenCalled();
});
