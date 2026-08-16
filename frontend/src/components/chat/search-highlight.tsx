interface SearchHighlightProps {
  value: string;
  query: string;
  className?: string;
}

export default function SearchHighlight({ value, query, className }: SearchHighlightProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const matchIndex = normalizedQuery ? value.toLowerCase().indexOf(normalizedQuery) : -1;
  if (matchIndex < 0) return <span className={className}>{value}</span>;

  const matchEnd = matchIndex + normalizedQuery.length;
  return (
    <span className={className}>
      {value.slice(0, matchIndex)}
      <mark>{value.slice(matchIndex, matchEnd)}</mark>
      {value.slice(matchEnd)}
    </span>
  );
}
