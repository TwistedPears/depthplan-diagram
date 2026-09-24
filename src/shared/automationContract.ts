import { mcpTools } from './mcpRegistry';
import { z } from 'zod';
import { type ApiErrorCode, type ApiResult } from './depthApiContract';

export const toolName = z.enum(
  Object.keys(mcpTools) as [
    keyof typeof mcpTools,
    ...Array<keyof typeof mcpTools>,
  ],
);
export const automationRequest = z.strictObject({
  tool: toolName,
  input: z.unknown(),
});
export type AutomationRequest = z.infer<typeof automationRequest>;
export type AutomationStatus = {
  folders?: import('./mcpFileContract').FolderGrant[];
  enabled: boolean;
  descriptor: string;
  executable: string;
};
export const unavailable = (
  code: ApiErrorCode = 'APP_UNAVAILABLE',
  message = 'The app is unavailable. Query current state before retrying an interrupted command with the same request ID.',
): ApiResult<never> => ({
  ok: false,
  state: null,
  error: {
    code,
    message,
    retryable: code === 'APP_UNAVAILABLE' || code === 'BUSY',
  },
});
export function validRequest(value: unknown): AutomationRequest | null {
  const parsed = automationRequest.safeParse(value);
  return parsed.success &&
    mcpTools[parsed.data.tool].input.safeParse(parsed.data.input).success
    ? parsed.data
    : null;
}
