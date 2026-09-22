"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useCurrentUser } from "@/hooks/use-current-user";
import { t } from "@/lib/utils";

// Customer filter for the sales list — server-side search (name/phone
// prefix, debounced), same pattern as the POS customer step. Value is
// "all" or a customer id; picking clears back to all.

export function CustomerFilter({
  value,
  onChange,
  className,
}: {
  value: Id<"customers"> | "all";
  onChange: (value: Id<"customers"> | "all") => void;
  /** Extra classes for the input group (e.g. compact height in filter bars). */
  className?: string;
}) {
  const user = useCurrentUser();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const customers = useQuery(
    api.customers.listActive,
    user == null ? "skip" : { search: debouncedQuery.trim() || undefined }
  );

  const items = useMemo(
    () =>
      (customers ?? []).map((c) => ({
        value: c._id,
        label: `${c.name}${c.phone ? ` · ${c.phone}` : ""}`,
      })),
    [customers]
  );

  const labelByValue = useMemo(
    () => new Map(items.map((i) => [i.value, i.label])),
    [items]
  );

  return (
    <Combobox
      items={items}
      itemToStringLabel={(v) => (v == null ? "" : labelByValue.get(v) ?? v)}
      value={value === "all" ? null : value}
      onValueChange={(v) => onChange(v ? (v as Id<"customers">) : "all")}
      // Only user typing drives the server search — Base UI's programmatic
      // fills (selection sync) arrive with a different reason.
      onInputValueChange={(inputValue, eventDetails) => {
        if (eventDetails?.reason === "input-change") setQuery(inputValue);
      }}
    >
      <ComboboxInput
        placeholder={t().sales.searchCustomers}
        showClear
        aria-label={t().sales.customer}
        className={className}
      />
      <ComboboxContent>
        <ComboboxEmpty>{t().sales.noCustomers}</ComboboxEmpty>
        <ComboboxList>
          {(customers ?? []).map((c) => (
            <ComboboxItem key={c._id} value={c._id}>
              <span className="truncate">{c.name}</span>
              {c.phone ? (
                <span className="text-xs text-muted-foreground">
                  · {c.phone}
                </span>
              ) : null}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
