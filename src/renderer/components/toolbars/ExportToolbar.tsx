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
        Export image
      </button>
      <button type="button" onClick={onExportJSON} disabled={isLoading}>
        Export DepthPlan
      </button>
    </>
  );
}
