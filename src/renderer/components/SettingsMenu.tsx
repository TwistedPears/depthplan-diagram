import AutomationControl from './AutomationControl';
import MenuFlyout from './MenuFlyout';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import type { ComponentProps } from 'react';

export default function SettingsMenu({
  active,
  onAction,
  ...automation
}: Omit<ComponentProps<typeof AutomationControl>, 'onShowDetails'> & {
  active: boolean;
  onAction: () => void;
}) {
  const workspace = useProjectWorkspace()!;
  return (
    <>
      <MenuFlyout label="Settings" active={active}>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-label="Autosave"
          aria-checked={workspace.autosave}
          onClick={workspace.toggleAutosave}
        >
          <span>Autosave</span>
          <span className="automation-state">
            {workspace.autosave ? 'On' : 'Off'}
          </span>
        </button>
        <AutomationControl {...automation} onShowDetails={onAction} />
      </MenuFlyout>
      <div className="dropdown-separator" />
      <button
        type="button"
        onClick={() => {
          onAction();
          void window.desktop.quit();
        }}
      >
        Quit DepthPlan
      </button>
    </>
  );
}
