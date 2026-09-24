import { useCallback, useEffect, useRef, useState } from 'react';
import {
  automationRequest,
  unavailable,
  validRequest,
  type AutomationStatus,
  type AutomationRequest,
} from '../../shared/automationContract';

export default function useAutomation(
  handlers: Partial<Record<AutomationRequest['tool'], (input: any) => unknown>>,
) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const enabled = useRef(false);
  const current = useRef(handlers);
  current.current = handlers;
  const refresh = useCallback(async () => {
    setChanging(true);
    setError('');
    try {
      const value = await window.desktop.automation.status();
      setStatus(value);
      enabled.current = value.enabled;
    } catch {
      setStatus(null);
      enabled.current = false;
      setError('MCP Server status is unavailable. Retry to check access.');
    } finally {
      setChanging(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return window.desktop.automation.onRequest((raw) => {
      if (!enabled.current)
        return unavailable('DISABLED', 'Automation is disabled.');
      // Strip transport correlation fields, then validate the public boundary.
      const parsed = automationRequest.strip().safeParse(raw);
      const request = parsed.success ? validRequest(parsed.data) : null;
      return request
        ? (current.current[request.tool]?.(request.input) ??
            unavailable('APP_UNAVAILABLE', 'Tool handler is not ready.'))
        : unavailable('INVALID_REQUEST', 'Invalid tool input.');
    });
  }, [refresh]);
  const toggle = async () => {
    const next = !status?.enabled;
    if (!next) enabled.current = false;
    setChanging(true);
    setError('');
    try {
      const value = await window.desktop.automation.enable(next);
      enabled.current = value.enabled;
      setStatus(value);
    } catch {
      enabled.current = false;
      setStatus(null);
      setError('Could not change MCP Server status. Retry to check access.');
    } finally {
      setChanging(false);
    }
  };
  const folder = async (id?: string) => {
    setChanging(true);
    setError('');
    try {
      setStatus(
        await (id
          ? window.desktop.mcpFiles.revokeFolder(id)
          : window.desktop.mcpFiles.approveFolder()),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not change folder access',
      );
    } finally {
      setChanging(false);
    }
  };
  return { status, changing, error, refresh, toggle, folder };
}
