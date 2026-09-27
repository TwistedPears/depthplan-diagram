import { depthTools } from './depthApiContract';
import { editorTools } from './editorApiContract';
import { fileTools } from './mcpFileContract';
import { projectTools } from './mcpProjectContract';

export const mcpTools = {
  ...depthTools,
  ...editorTools,
  ...fileTools,
  ...projectTools,
};
