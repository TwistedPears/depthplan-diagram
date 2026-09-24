import Icon from '../Icon';

interface ExportToolbarProps {
  isLoading: boolean;
  onExportSVG: () => void;
  onExportJSON: () => void;
}

export default function ExportToolbar({
  isLoading,
  onExportSVG,
  onExportJSON,
}: ExportToolbarProps) {
  return (
    <>
      <button type="button" onClick={onExportSVG} disabled={isLoading}>
        <Icon name="file-export" /> Export image
      </button>
      <button type="button" onClick={onExportJSON} disabled={isLoading}>
        <Icon name="file-code" /> Export DepthPlan
      </button>
    </>
  );
}
