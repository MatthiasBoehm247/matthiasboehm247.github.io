/** Human-readable defaults. Zero is a value, not an empty optional field. */
export function exampleValue(value, maximum = 140) {
  if (value === null || value === undefined || value === '') return 'optional';
  const characters = Array.from(String(value));
  return characters.length > maximum ? characters.slice(0, maximum).join('') + '…' : characters.join('');
}
