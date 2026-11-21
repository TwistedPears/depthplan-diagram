import { depthTools } from './depthApiContract';
import { editorTools } from './editorApiContract';
import { fileTools } from './mcpFileContract';
import { projectTools } from './mcpProjectContract';
import { snapshotTools } from './mcpSnapshotContract';

export const mcpTools = {
  ...depthTools,
  ...editorTools,
  ...fileTools,
  ...projectTools,
  ...snapshotTools,
};
