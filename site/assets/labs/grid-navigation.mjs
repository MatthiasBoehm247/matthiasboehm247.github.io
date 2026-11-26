// Navigation for the local raster editor. Arrow keys stop at row/column edges.
// null means the key belongs to the browser or to the button activation action.
export function gridKeyTarget(index, rows, columns, key, control = false) {
  if (![index, rows, columns].every(Number.isInteger) || rows < 1 || columns < 1 || index < 0 || index >= rows * columns) {
    throw new RangeError('Ungültige Rasterposition.');
  }
  const row = Math.floor(index / columns), column = index % columns;
  switch (key) {
    case 'ArrowLeft': return row * columns + Math.max(0, column - 1);
    case 'ArrowRight': return row * columns + Math.min(columns - 1, column + 1);
    case 'ArrowUp': return Math.max(0, row - 1) * columns + column;
    case 'ArrowDown': return Math.min(rows - 1, row + 1) * columns + column;
    case 'Home': return control ? 0 : row * columns;
    case 'End': return control ? rows * columns - 1 : row * columns + columns - 1;
    default: return null;
  }
}
