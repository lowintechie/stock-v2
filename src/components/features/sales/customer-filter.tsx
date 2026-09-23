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
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn, t, comboboxLabel } from "@/lib/utils";

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

  const selectedCustomer = useQuery(
    api.customers.get,
    user == null || value === "all" ? "skip" : { customerId: value }
  );

  // Cache of known customer labels (id -> "Name · Phone") so we never lose
  // the label when search terms change or customers paginate.
  const [labelCache, setLabelCache] = useState<Map<string, string>>(
    () => new Map()
  );

  useEffect(() => {
    let changed = false;
    const next = new Map(labelCache);
    if (selectedCustomer) {
      const label = `${selectedCustomer.name}${selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}`;
      if (next.get(selectedCustomer._id) !== label) {
        next.set(selectedCustomer._id, label);
        changed = true;
      }
    }
    for (const c of customers ?? []) {
      const label = `${c.name}${c.phone ? ` · ${c.phone}` : ""}`;
      if (next.get(c._id) !== label) {
        next.set(c._id, label);
        changed = true;
      }
    }
    if (changed) {
      setLabelCache(next);
    }
  }, [selectedCustomer, customers, labelCache]);

  // If a customer was deleted from DB or invalid, reset filter to "all".
  useEffect(() => {
    if (value !== "all" && selectedCustomer === null) {
      onChange("all");
    }
  }, [value, selectedCustomer, onChange]);

  const items = useMemo(() => {
    const list = (customers ?? []).map((c) => ({
      value: c._id,
      label: `${c.name}${c.phone ? ` · ${c.phone}` : ""}`,
    }));
    // When no search query is active and a customer is selected, ensure they appear
    // in the dropdown list even if outside the top 100.
    if (
      !debouncedQuery.trim() &&
      value !== "all" &&
      !list.some((i) => i.value === value)
    ) {
      const cachedLabel = labelCache.get(value);
      if (cachedLabel) {
        list.unshift({ value, label: cachedLabel });
      }
    }
    return list;
  }, [customers, debouncedQuery, value, labelCache]);

  const isInitialLoading =
    value !== "all" && !labelCache.has(value) && selectedCustomer === undefined;

  if (isInitialLoading) {
    return (
      <InputGroup className={cn("w-full opacity-60", className)}>
        <InputGroupInput disabled placeholder={t().sales.searchCustomers} />
      </InputGroup>
    );
  }

  return (
    <Combobox
      items={items}
      filter={null}
      itemToStringLabel={comboboxLabel(labelCache)}
      value={value === "all" ? null : value}
      onValueChange={(v) => {
        onChange(v ? (v as Id<"customers">) : "all");
        setQuery("");
        setDebouncedQuery("");
      }}
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
        onFocus={(e) => (e.target as HTMLInputElement).select()}
      />
      <ComboboxContent>
        <ComboboxEmpty>{t().sales.noCustomers}</ComboboxEmpty>
        <ComboboxList>
          {items.map((item) => (
            <ComboboxItem key={item.value} value={item.value}>
              <span className="truncate">{item.label}</span>
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
