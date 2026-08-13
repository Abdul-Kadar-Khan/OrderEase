/** Search input for finding a product to add to the order. */
export function ProductSearchBar({ value, onChange, disabled }) {
  return (
    <s-text-field
      label="Search products"
      value={value}
      disabled={disabled}
      // onInput fires on every keystroke, which is what we want for live search.
      // The useProductSearch hook debounces internally, so this is safe.
      onInput={(e) => onChange(e.target.value)}
    />
  );
}
