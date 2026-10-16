"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  SORT_OPTIONS,
  buildCatalogueHref,
  isCatalogueSort,
  type CatalogueSort,
} from "@/lib/catalog/products";

const SEARCH_DEBOUNCE_MS = 400;

export interface FilterBarState {
  q?: string;
  sort: CatalogueSort;
  minPrice?: number;
  maxPrice?: number;
  categorySlug?: string;
}

/**
 * Catalogue controls: debounced search, sort, price range, clear.
 * Single client island — everything else on /products stays server
 * rendered. All state lands in the URL (shareable, back/forward safe).
 * On mobile the panel collapses behind a disclosure button.
 */
export function FilterBar({ initial }: { initial: FilterBarState }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initial.q ?? "");
  const [min, setMin] = useState(
    initial.minPrice !== undefined ? String(initial.minPrice) : "",
  );
  const [max, setMax] = useState(
    initial.maxPrice !== undefined ? String(initial.maxPrice) : "",
  );
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The page remounts this component (via `key`, excluding the live
  // search text) whenever committed filter state changes. While typing,
  // the input keeps local state so focus is never stolen; when the URL
  // changes underneath us (back/forward, clear links) we resync — but
  // never while the user is typing in the field.
  useEffect(() => {
    if (document.activeElement !== searchRef.current) {
      setQ(initial.q ?? "");
    }
  }, [initial.q]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  const apply = (next: {
    q?: string;
    sort?: CatalogueSort;
    min?: string;
    max?: string;
  }) => {
    const num = (v: string): number | undefined => {
      if (v.trim() === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    router.replace(
      buildCatalogueHref({
        q: next.q !== undefined ? next.q.trim() || undefined : initial.q,
        categorySlug: initial.categorySlug,
        sort: next.sort ?? initial.sort,
        minPrice: next.min !== undefined ? num(next.min) : initial.minPrice,
        maxPrice: next.max !== undefined ? num(next.max) : initial.maxPrice,
      }),
      { scroll: false },
    );
  };

  const onSearch = (value: string) => {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply({ q: value }), SEARCH_DEBOUNCE_MS);
  };

  const hasFilters =
    (initial.q ?? "") !== "" ||
    initial.categorySlug !== undefined ||
    initial.sort !== (initial.q ? "relevance" : "featured") ||
    initial.minPrice !== undefined ||
    initial.maxPrice !== undefined;

  const fields = (
    <form
      role="search"
      aria-label="Filter products"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (debounce.current) clearTimeout(debounce.current);
        apply({ q, min, max });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="catalogue-search" className="text-sm font-semibold text-zinc-800">
          Search
        </label>
        <input
          ref={searchRef}
          id="catalogue-search"
          type="search"
          autoComplete="off"
          placeholder="Try “ladder” or “300kg”"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-700"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="catalogue-sort" className="text-sm font-semibold text-zinc-800">
            Sort by
          </label>
          <select
            id="catalogue-sort"
            value={initial.sort}
            onChange={(e) => {
              const v = e.target.value;
              if (isCatalogueSort(v)) apply({ sort: v });
            }}
            className="h-11 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-brand-700"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          {hasFilters ? (
            <Link
              href="/products"
              className="inline-flex h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Clear all
            </Link>
          ) : null}
        </div>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold text-zinc-800">
          Price range (₹)
        </legend>
        <div className="flex items-center gap-2">
          <label htmlFor="catalogue-min" className="sr-only">
            Minimum price in rupees
          </label>
          <input
            id="catalogue-min"
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Min"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-700"
          />
          <span aria-hidden className="text-zinc-400">
            –
          </span>
          <label htmlFor="catalogue-max" className="sr-only">
            Maximum price in rupees
          </label>
          <input
            id="catalogue-max"
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Max"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-700"
          />
          <button
            type="submit"
            className="h-11 shrink-0 cursor-pointer rounded-md bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Apply
          </button>
        </div>
      </fieldset>
    </form>
  );

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="catalogue-filters"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between rounded-md py-1 text-sm font-bold text-zinc-900 md:hidden"
      >
        Search &amp; filters
        <span aria-hidden className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      <div className="hidden md:block">{fields}</div>
      {open ? (
        <div id="catalogue-filters" className="mt-3 md:hidden">
          {fields}
        </div>
      ) : null}
      {hasFilters ? (
        <p className="mt-3 text-xs text-zinc-500 md:hidden">
          Filters active —{" "}
          <Link href="/products" className="font-semibold text-brand-700 hover:underline">
            clear all
          </Link>
        </p>
      ) : null}
    </div>
  );
}
