"use client";

import { useEffect } from "react";
import { useSearchBox } from "react-instantsearch";

export default function SearchQuerySync({ query }: { query: string }) {
  const { query: currentQuery, refine } = useSearchBox();

  useEffect(() => {
    if (currentQuery !== query) refine(query);
  }, [currentQuery, query, refine]);

  return null;
}
