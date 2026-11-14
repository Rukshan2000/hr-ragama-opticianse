"use client";

import { useState } from "react";
import type { SortState } from "@/components/shared/data-table";
import { useDebounced } from "./use-debounced";

/** Page/search/sort state for a paginated list; search changes reset to page 1. */
export function useListState(initial: SortState, initialSearch = "") {
  const [page, setPage] = useState(1);
  const [limit, setLimitRaw] = useState(10);
  const [search, setSearchRaw] = useState(initialSearch);
  const [sort, setSortRaw] = useState(initial);
  const debouncedSearch = useDebounced(search.trim());
  return {
    page,
    setPage,
    search,
    setSearch: (v: string) => {
      setSearchRaw(v);
      setPage(1);
    },
    limit,
    setLimit: (n: number) => {
      setLimitRaw(n);
      setPage(1);
    },
    sort,
    setSort: (s: SortState) => {
      setSortRaw(s);
      setPage(1);
    },
    params: { page, limit, sort: sort.sort, order: sort.order, search: debouncedSearch || undefined },
  };
}
