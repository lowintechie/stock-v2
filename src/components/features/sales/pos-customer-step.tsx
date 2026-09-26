"use client";

import { Cancel01Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/use-current-user";
import { t, toastError, comboboxLabel } from "@/lib/utils";

// T10 — POS customer step (AGENTS.md, checkout step ②). The combobox search
// is SERVER-side (api.customers.listActive, name/phone prefix, debounced).
// New-customer creation atomically reuses an existing normalized phone, so a
// repeat entry selects that customer instead of creating another record.

export function PosCustomerStep({
  customerId,
  customer: customerProp,
  onSelect,
}: {
  customerId: string | null;
  customer?: Doc<"customers"> | null;
  onSelect: (customer: Doc<"customers">) => void;
}) {
  const user = useCurrentUser();

  // Search term + debounced copy that drives the server query.
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

  const queriedCustomer = useQuery(
    api.customers.get,
    user == null || !customerId
      ? "skip"
      : { customerId: customerId as Id<"customers"> }
  );
  const currentCustomer = customerProp ?? queriedCustomer;

  // Cache of known customer docs and labels so we never lose
  // the label or doc when search terms change or customers paginate.
  const [labelCache, setLabelCache] = useState<Map<string, string>>(
    () => new Map()
  );
  const [docCache, setDocCache] = useState<Map<string, Doc<"customers">>>(
    () => new Map()
  );

  useEffect(() => {
    let changed = false;
    const nextLabels = new Map(labelCache);
    const nextDocs = new Map(docCache);

    if (currentCustomer) {
      const label = `${currentCustomer.name}${currentCustomer.phone ? ` · ${currentCustomer.phone}` : ""}`;
      if (nextLabels.get(currentCustomer._id) !== label) {
        nextLabels.set(currentCustomer._id, label);
        nextDocs.set(currentCustomer._id, currentCustomer);
        changed = true;
      }
    }
    for (const c of customers ?? []) {
      const label = `${c.name}${c.phone ? ` · ${c.phone}` : ""}`;
      if (nextLabels.get(c._id) !== label) {
        nextLabels.set(c._id, label);
        nextDocs.set(c._id, c);
        changed = true;
      }
    }
    if (changed) {
      setLabelCache(nextLabels);
      setDocCache(nextDocs);
    }
  }, [currentCustomer, customers, labelCache, docCache]);

  const items = useMemo(() => {
    const list: { value: string; label: string }[] = (customers ?? []).map(
      (c) => ({
        value: c._id,
        label: `${c.name}${c.phone ? ` · ${c.phone}` : ""}`,
      })
    );
    // When no search query is active and a customer is selected, ensure they appear
    // in the dropdown list even if outside the top 100.
    if (
      !debouncedQuery.trim() &&
      customerId &&
      !list.some((i) => i.value === customerId)
    ) {
      const cachedLabel = labelCache.get(customerId);
      if (cachedLabel) {
        list.unshift({ value: customerId, label: cachedLabel });
      }
    }
    return list;
  }, [customers, debouncedQuery, customerId, labelCache]);

  const isInitialLoading =
    customerId != null && !labelCache.has(customerId) && currentCustomer === undefined;

  // --- New-customer dialog ---
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const createOrGet = useMutation(api.customers.createOrGetByPhone);

  async function doCreate() {
    setCreating(true);
    try {
      const result = await createOrGet({
        name,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
      });
      toast.success(
        result.created ? t().customers.created : t().customers.existingSelected
      );
      setNewOpen(false);
      setName("");
      setPhone("");
      setAddress("");
      onSelect(result.customer);
    } catch (err) {
      toastError(err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="flex w-full items-center gap-2">
        <div className="min-w-0 flex-1">
          {isInitialLoading ? (
            <InputGroup className="w-full opacity-60">
              <InputGroupInput disabled placeholder={t().sales.searchCustomers} />
            </InputGroup>
          ) : (
            <Combobox
              items={items}
              filter={null}
              itemToStringLabel={comboboxLabel(labelCache)}
              value={customerId}
              onValueChange={(value) => {
                if (!value) return;
                const found = docCache.get(value);
                if (found) onSelect(found);
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
                // Select the current value on focus so typing replaces it.
                onFocus={(e) => (e.target as HTMLInputElement).select()}
              />
              <ComboboxContent>
                <ComboboxEmpty>{t().sales.noCustomers}</ComboboxEmpty>
                <ComboboxList>
                  {items.map((item) => {
                    const c = docCache.get(item.value);
                    return (
                      <ComboboxItem key={item.value} value={item.value}>
                        <span className="truncate">{c ? c.name : item.label}</span>
                        {c?.phone ? (
                          <span className="text-xs text-muted-foreground">
                            · {c.phone}
                          </span>
                        ) : null}
                      </ComboboxItem>
                    );
                  })}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
        </div>
        {/* Always INLINE beside the selector — icon-only on phone (44px
            tap target), icon + text from sm up. */}
        <Button
          type="button"
          variant="outline"
          className="size-11 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-3"
          onClick={() => setNewOpen(true)}
          aria-label={t().sales.newCustomer}
        >
          <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} className="size-4" />
          <span className="hidden sm:inline">{t().sales.newCustomer}</span>
        </Button>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t().sales.newCustomer}</DialogTitle>
            <DialogDescription>{t().customers.nameHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pos-new-customer-name">{t().common.name}</Label>
              <Input
                id="pos-new-customer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pos-new-customer-phone">{t().customers.phone}</Label>
              <Input
                id="pos-new-customer-phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={30}
                placeholder="012 345 678"
              />
              <p className="text-xs text-muted-foreground">
                {t().customers.phoneHint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pos-new-customer-address">{t().customers.address}</Label>
              <Textarea
                id="pos-new-customer-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={300}
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                {t().customers.addressHint}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={creating || !name.trim()}
              onClick={() => void doCreate()}
            >
              {t().common.save}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={creating}
              onClick={() => setNewOpen(false)}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
              {t().common.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
