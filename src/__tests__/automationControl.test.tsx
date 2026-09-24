import { fireEvent, render, screen } from '@testing-library/react';
import AutomationControl, {
  codexConfiguration,
} from '../renderer/components/AutomationControl';
import useAutomation from '../renderer/hooks/useAutomation';
import type { AutomationStatus } from '../shared/automationContract';

const status: AutomationStatus = {
  enabled: false,
  executable: 'C:\\Program Files\\DepthPlan\\DepthPlan.exe',
  descriptor: '/private/runtime space/connection.json',
};
const handlers = {
  depthplan_get_context: jest.fn(() => ({ ok: true })),
  depthplan_get_hierarchy: jest.fn(),
  depthplan_set_depth: jest.fn(),
  depthplan_reveal_all: jest.fn(),
};
function Control() {
  const automation = useAutomation(handlers);
  return <AutomationControl automation={automation} onShowDetails={() => {}} />;
}
let request: (value: unknown) => any;
const getStatus = jest.fn();
const enable = jest.fn();
const writeText = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  getStatus.mockResolvedValue(status);
  enable.mockImplementation(async (enabled) => ({ ...status, enabled }));
  writeText.mockResolvedValue(undefined);
  Object.assign(window, {
    desktop: {
      clipboard: { writeText },
      automation: {
        status: getStatus,
        enable,
        onRequest: (listener: typeof request) => {
          request = listener;
          return jest.fn();
        },
      },
    },
  });
});

test('enables one service, copies setup, revokes calls, and reconnects without a new service', async () => {
  render(<Control />);
  await screen.findByText('Off');
  expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toBeChecked();
  expect(
    screen.queryByRole('button', { name: 'MCP Details' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Codex configuration'),
  ).not.toBeInTheDocument();
  expect(request({ tool: 'depthplan_get_context', input: {} }).error.code).toBe(
    'DISABLED',
  );
  fireEvent.click(screen.getByRole('switch', { name: 'MCP Server' }));
  fireEvent.click(await screen.findByRole('button', { name: 'MCP Details' }));
  expect(screen.getByRole('dialog', { name: 'MCP Details' })).toBeVisible();
  await screen.findByLabelText('Codex configuration');
  expect(request({ tool: 'depthplan_get_context', input: {} })).toEqual({
    ok: true,
  });
  expect(
    request({ tool: 'depthplan_get_context', input: { unknown: true } }).error
      .code,
  ).toBe('INVALID_REQUEST');
  fireEvent.click(screen.getByText('Copy Codex configuration'));
  await screen.findByText('Configuration copied.');
  expect(writeText).toHaveBeenCalledWith(codexConfiguration(status));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: 'MCP Server' }));
  expect(request({ tool: 'depthplan_get_context', input: {} }).error.code).toBe(
    'DISABLED',
  );
  await screen.findByText('Off');
  expect(
    screen.queryByRole('button', { name: 'MCP Details' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: 'MCP Server' }));
  await screen.findByText('On');
  expect(enable.mock.calls).toEqual([[true], [false], [true]]);
});

test('unknown status and failed transitions can be retried; clipboard failure has a manual fallback', async () => {
  getStatus.mockRejectedValueOnce(new Error('status unavailable'));
  render(<Control />);
  await screen.findByRole('alert');
  expect(screen.getByRole('switch', { name: 'MCP Server' })).toBeDisabled();
  fireEvent.click(screen.getByText('Retry MCP Server status'));
  await screen.findByText('Off');
  enable.mockRejectedValueOnce(new Error('failed'));
  fireEvent.click(screen.getByRole('switch', { name: 'MCP Server' }));
  await screen.findByText(
    'Could not change MCP Server status. Retry to check access.',
  );
  expect(request({ tool: 'depthplan_get_context', input: {} }).error.code).toBe(
    'DISABLED',
  );
  getStatus.mockResolvedValue({ ...status, enabled: true });
  fireEvent.click(screen.getByText('Retry MCP Server status'));
  await screen.findByText('On');
  fireEvent.click(screen.getByRole('button', { name: 'MCP Details' }));
  writeText.mockRejectedValueOnce(new Error('clipboard denied'));
  fireEvent.click(screen.getByText('Copy Codex configuration'));
  await screen.findByText('Select the configuration and copy it manually.');
  expect(screen.getByLabelText('Codex configuration')).toHaveValue(
    codexConfiguration(status),
  );
});
