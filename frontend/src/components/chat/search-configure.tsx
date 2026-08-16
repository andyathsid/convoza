"use client";

import type { ComponentType } from "react";
import { Configure } from "react-instantsearch";

interface SearchConfigureProps {
  filters?: string;
  hitsPerPage?: number;
}

// InstantSearch derives this type from optional Algolia packages even though
// alternative adapters accept the same standard search parameters at runtime.
const SearchConfigure = Configure as unknown as ComponentType<SearchConfigureProps>;

export default SearchConfigure;
