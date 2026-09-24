import { depthTools } from './depthApiContract';
import { editorTools } from './editorApiContract';
import { fileTools } from './mcpFileContract';

export const mcpTools = { ...depthTools, ...editorTools, ...fileTools };
