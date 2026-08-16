const searchEngine = process.env.NEXT_PUBLIC_SEARCH_ENGINE;

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildEqualityFilter(field: string, value: string): string {
  const escapedValue = escapeFilterValue(value);

  if (searchEngine === "meilisearch") {
    return `${field} = "${escapedValue}"`;
  }

  return `${field}:${escapedValue}`;
}

export function buildNumericRangeFilter(
  field: string,
  minimum: number,
  maximum: number
): string {
  if (searchEngine === "meilisearch") {
    return `${field} >= ${minimum} AND ${field} <= ${maximum}`;
  }

  return `${field}:[${minimum}..${maximum}]`;
}

export function combineFilters(...filters: Array<string | undefined>): string {
  return filters
    .filter(Boolean)
    .join(searchEngine === "meilisearch" ? " AND " : " && ");
}
