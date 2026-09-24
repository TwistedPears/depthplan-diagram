export default function Icon({
  name,
  rotation = 0,
  className,
  mirror = false,
}: {
  name: string;
  rotation?: number;
  className?: string;
  mirror?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="1.2em"
      height="1.2em"
      fill="currentColor"
      className={className}
      style={{
        verticalAlign: '-0.225em',
        overflow: 'visible',
        transform: `rotate(${rotation}deg) scaleX(${mirror ? -1 : 1})`,
      }}
    >
      <use href={`#icon-${name}`} />
    </svg>
  );
}
