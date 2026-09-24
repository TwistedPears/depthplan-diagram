const strokeColors = [
  ['Black', '#1e1e1e'],
  ['Red', '#e03131'],
  ['Green', '#2f9e44'],
  ['Blue', '#1971c2'],
  ['Orange', '#f08c00'],
];
const backgroundColors = [
  ['Transparent', 'transparent'],
  ['Pink', '#ffc9c9'],
  ['Green', '#b2f2bb'],
  ['Blue', '#a5d8ff'],
  ['Yellow', '#ffec99'],
];

export default function PropertyColorPalette({
  label,
  value,
  background = false,
  onChange,
}: {
  label: string;
  value: string;
  background?: boolean;
  onChange: (color: string) => void;
}) {
  return (
    <fieldset className="property-group">
      <legend>{label}</legend>
      <div className="property-colors">
        {(background ? backgroundColors : strokeColors).map(([name, color]) => (
          <button
            key={color}
            type="button"
            className={`color-swatch${color === 'transparent' ? ' transparent-swatch' : ''}`}
            style={{ backgroundColor: color }}
            aria-label={`${label}: ${name}`}
            aria-pressed={value.toLowerCase() === color}
            title={name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(color)}
          />
        ))}
        <input
          type="color"
          aria-label={`Custom ${label.toLowerCase()} color`}
          title={`Custom ${label.toLowerCase()} color`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </fieldset>
  );
}
