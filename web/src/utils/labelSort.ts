type NamedLabel = {
  readonly name?: string | null;
};

export function sortLabelsByName<T extends NamedLabel>(
  labels: readonly T[],
  locale?: string,
): T[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  return [...labels].sort((left, right) =>
    collator.compare(left.name ?? "", right.name ?? ""),
  );
}
