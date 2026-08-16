interface SearchEmptyProps {
  query: string;
  totalHits: number;
}

export default function SearchEmpty({ query, totalHits }: SearchEmptyProps) {
  if (!query.trim()) return null;
  if (totalHits > 0) return null;

  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
      No results found
    </div>
  );
}
