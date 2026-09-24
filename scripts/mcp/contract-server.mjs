// Compatibility fixture only: no desktop connection or mutation is implemented.
import { McpServer } from '@modelcontextprotocol/server';
import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';
import { writeFileSync } from 'node:fs';
import { depthTools } from '../../src/shared/depthApiContract.ts';

const transport = new StdioServerTransport();
const send = transport.send.bind(transport);
transport.send = async (message) => {
  if (message.result?.protocolVersion && process.env.DEPTHPLAN_PROBE_RESULT)
    writeFileSync(
      process.env.DEPTHPLAN_PROBE_RESULT,
      message.result.protocolVersion,
    );
  await send(message);
};
serveStdio(
  () => {
    const server = new McpServer({
      name: 'depthplan-contract-spike',
      version: '0.1.0',
    });
    for (const [name, tool] of Object.entries(depthTools)) {
      server.registerTool(
        name,
        {
          description:
            'DepthPlan contract compatibility fixture. No live document is connected.',
          inputSchema: tool.input,
          outputSchema: tool.output,
          annotations: {
            readOnlyHint: tool.readOnly,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        async () => {
          const result = tool.output.parse({
            ok: false,
            state: null,
            error: {
              code: 'APP_UNAVAILABLE',
              message: 'Contract fixture only',
              retryable: true,
            },
          });
          return {
            isError: true,
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        },
      );
    }
    return server;
  },
  { transport },
);
