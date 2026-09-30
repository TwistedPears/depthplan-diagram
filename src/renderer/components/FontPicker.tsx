import { useEffect, useState } from 'react';
import { fontFamily, genericFonts } from '../../shared/textFont';
import Icon from './Icon';
import MenuFlyout from './MenuFlyout';

const favoritesKey = 'depthplan.favoriteFonts';
function savedFavorites(): string[] | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(favoritesKey) ?? 'null',
    );
    return Array.isArray(value) &&
      value.every((name) => typeof name === 'string' && name.trim())
      ? [...new Set(value)]
      : null;
  } catch {
    return null;
  }
}

function defaultFavorites(fonts: string[]) {
  const mono = 'monospace';
  return [
    ...new Set([
      'Arial',
      'Verdana',
      'Georgia',
      'Times New Roman',
      'Helvetica',
      ...fonts,
    ]),
  ]
    .filter((name) => name !== mono && fonts.includes(name))
    .slice(0, 4)
    .concat(mono);
}

export default function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (font: string) => void;
}) {
  const [fonts, setFonts] = useState(genericFonts);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(savedFavorites);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    let active = true;
    window.desktop
      ?.fonts?.()
      .then((names) => {
        if (active)
          setFonts(
            [...new Set([...names, ...genericFonts])].sort((a, b) =>
              a.localeCompare(b),
            ),
          );
      })
      .catch(() => {
        if (active) setError('System fonts unavailable. Using standard fonts.');
      });
    return () => {
      active = false;
    };
  }, []);
  const favorites = saved ?? defaultFavorites(fonts);
  const rows = (names: string[]) =>
    names.map((name) => (
      <div className="font-choice" key={name} role="none">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={value === name}
          aria-label={name}
          style={{ fontFamily: fontFamily(name) }}
          title={fonts.includes(name) ? name : `${name} (fallback)`}
          onClick={(event) => {
            event.currentTarget
              .closest<HTMLElement>('[popover]')!
              .hidePopover();
            onChange(name);
          }}
        >
          <span>{name}</span>
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          className="font-star"
          data-font-star={name}
          aria-label={`Favorite ${name}`}
          title={`${favorites.includes(name) ? 'Unstar' : 'Star'} ${name}`}
          aria-checked={favorites.includes(name)}
          onClick={(event) => {
            const panel =
              event.currentTarget.closest<HTMLElement>('[popover]')!;
            const next = favorites.includes(name)
              ? favorites.filter((font) => font !== name)
              : [...favorites, name];
            setSaved(next);
            try {
              localStorage.setItem(favoritesKey, JSON.stringify(next));
            } catch {
              setError('Favorites could not be saved.');
            }
            requestAnimationFrame(() =>
              (
                [
                  ...panel.querySelectorAll<HTMLButtonElement>(
                    '[data-font-star]',
                  ),
                ].find((button) => button.dataset.fontStar === name) ??
                panel.querySelector<HTMLButtonElement>('button')
              )?.focus(),
            );
          }}
        >
          <Icon name="star" />
        </button>
      </div>
    ));
  return (
    <fieldset className="property-group">
      <legend>Font</legend>
      <MenuFlyout
        label="Text font"
        active
        className="font-picker"
        trigger={
          <>
            <span>{value}</span>
            <Icon name="chevron-right" />
          </>
        }
        onOpen={() => {
          setSaved(savedFavorites());
          setShowAll(false);
        }}
      >
        <h3>Favorites</h3>
        {favorites.length ? (
          rows(favorites)
        ) : (
          <p>No favorites. Star fonts from the full list.</p>
        )}
        <button
          type="button"
          role="menuitem"
          className="font-see-all"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show favorites only' : 'See all fonts'}
        </button>
        {showAll && (
          <>
            <h3>All fonts</h3>
            {rows(
              [...new Set([value, ...fonts])]
                .filter((name) => !favorites.includes(name))
                .sort((a, b) => a.localeCompare(b)),
            )}
          </>
        )}
        {!fonts.includes(value) && (
          <p>{value} is unavailable. Using a fallback font.</p>
        )}
        {error && <p role="status">{error}</p>}
      </MenuFlyout>
    </fieldset>
  );
}
