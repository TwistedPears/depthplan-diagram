import type { FolderGrant } from './mcpFileContract';

const separator = (path: string) =>
  path.includes('\\') && !path.includes('/') ? '\\' : '/';
const parentOf = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf(separator(path)))) ||
  separator(path);
// Native paths are canonical; compare at separator boundaries, never by raw prefix.
const within = (path: string, folder: string) =>
  path === folder ||
  path.startsWith(
    folder.endsWith(separator(folder)) ? folder : folder + separator(folder),
  );

/** Explain each grant in terms an MCP client can act on without seeing the UI. */
export function describeAccess(
  folders: FolderGrant[],
  appInstanceId: string,
  projectLocation: string | null,
) {
  const project = projectLocation && parentOf(projectLocation);
  return {
    appInstanceId,
    folders: folders.map((grant) =>
      project && within(grant.path, project)
        ? {
            ...grant,
            writable: false,
            reason: `Inside the open project folder ${project}. Its writer lock rejects Save As copies and exports here; choose a destination outside it.`,
          }
        : project && within(project, grant.path)
          ? {
              ...grant,
              writable: true,
              reason: `Contains the open project folder ${project}; writes inside that folder are rejected while the project is open.`,
            }
          : { ...grant, writable: true },
    ),
    ...(folders.length
      ? {}
      : {
          note: `No folders are approved in this DepthPlan instance (appInstanceId ${appInstanceId}). Grants reset on every launch; ask the user to choose MCP Details → Approve folder… in this instance. If a folder is listed there, this client uses another instance's descriptor: make its --descriptor match the Descriptor shown in that window's MCP Details, then restart the client's MCP server.`,
        }),
  };
}
