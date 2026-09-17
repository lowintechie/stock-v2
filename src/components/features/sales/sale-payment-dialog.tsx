"use client";

import { Cancel01Icon, MoneyAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormDate } from "@/components/features/forms/form-date";
import { FormInput } from "@/components/features/forms/form-input";
import {
  FormMoney,
  moneyInputSchema,
} from "@/components/features/forms/form-money";
import { FormSelect } from "@/components/features/forms/form-select";
import { useIdempotentSubmit } from "@/hooks/use-idempotent-submit";
import {
  centsToInput,
  formatMoney,
  getLang,
  inputToCents,
  t,
  toastError,
} from "@/lib/utils";

// "Create a payment" from the sales list — records money received for an
// order that is not fully paid yet. The still-owed amount is prefilled;
// the date is backdatable (cash-basis reports count money on the day it
// was received); the change is shown live when the received amount exceeds
// the still-owed amount (the server clamps the stored row — change is never
// saved). Total/paid/remaining come from the Convex-live list row, so the
// dialog never shows stale numbers.

type CheckoutMethod = "cash" | "bank_transfer" | "other";

const schema = z.object({
  amount: moneyInputSchema,
  method: z.enum(["cash", "bank_transfer", "other"]),
  receivedAt: z.number(),
  note: z.string().max(500),
});

type FormValues = z.infer<typeof schema>;

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function SalePaymentDialog({
  saleId,
  total,
  paid,
  remaining,
  currency,
  onClose,
}: {
  saleId: Id<"sales">;
  total: number;
  paid: number;
  remaining: number;
  currency: string;
  onClose: () => void;
}) {
  const receive = useMutation(api.payments.receive);
  const receiveSubmit = useIdempotentSubmit({
    operation: "payments.receive",
    resource: saleId,
  });

  // Captured once on mount — the payment date defaults to NOW (the actual
  // receipt moment) and is capped at today (backdating allowed, future
  // not). Only an explicit earlier date changes the recorded day.
  const [maxDate] = useState(() => Date.now());

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: centsToInput(remaining),
      method: "cash",
      receivedAt: maxDate,
      note: "",
    },
  });

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Reactive amount for the UI (button state, change display).
  const amountWatched = useWatch({ control: form.control, name: "amount" });
  const entered = inputToCents(amountWatched ?? "") ?? 0;

  async function save(values: FormValues) {
    if (savingRef.current) return;
    // Guard: if the list query still shows the order as fully paid (stale
    // data from a just-created sale), don't send to the server.
    if (remaining <= 0) {
      toast.error(t().errors.INVALID_PAYMENT);
      return;
    }
    // The form value can be empty on the very first submit if the field
    // hasn't fully registered yet — fall back to the remaining prop.
    const amount =
      inputToCents(values.amount) || inputToCents(centsToInput(remaining)) || 0;
    if (amount <= 0) {
      toast.error(t().errors.INVALID_PAYMENT);
      return;
    }
    // The server clamps overpay to remaining — if remaining is stale (0 on
    // the server but positive on the client), the server would reject.
    // Clamp client-side too so the request is always valid.
    const clampedAmount = Math.min(amount, remaining);
    if (clampedAmount <= 0) {
      toast.error(t().errors.INVALID_PAYMENT);
      return;
    }
    // Default to NOW at save time — the date picker's ms→string→midnight
    // roundtrip can produce a timestamp hours ahead of the server's clock.
    // Only use the form's date if the user explicitly picked an earlier day.
    // Subtract 5s to absorb client-vs-server clock skew.
    const now = Date.now() - 5000;
    const receivedAt = values.receivedAt < now ? values.receivedAt : now;
    savingRef.current = true;
    setSaving(true);
    try {
      const receivePayload = {
        saleId,
        amount: clampedAmount,
        method: values.method,
        receivedAt,
        note: values.note.trim() || undefined,
      };
      const idempotencyKey = receiveSubmit.begin(receivePayload);
      await receive({ ...receivePayload, idempotencyKey });
      receiveSubmit.complete(receivePayload, idempotencyKey);
      toast.success(
        clampedAmount > remaining
          ? t().sales.paymentAddedWithChange.replace(
              "{amount}",
              formatMoney(clampedAmount - remaining, currency, getLang())
            )
          : t().sales.paymentAdded
      );
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submit(values: FormValues) {
    void save(values);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    void form.handleSubmit(submit)(event);
  }

  const methodOptions: { value: CheckoutMethod; label: string }[] = [
    { value: "cash", label: t().sales.methods.cash },
    { value: "bank_transfer", label: t().sales.methods.bank_transfer },
    { value: "other", label: t().sales.methods.other },
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t().sales.createPayment}</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {/* Still owed — the pending amount this payment covers. */}
            <div className="flex flex-col gap-1 rounded-md border p-3">
              <SummaryRow
                label={t().sales.total}
                value={formatMoney(total, currency, getLang())}
              />
              <SummaryRow
                label={t().sales.paid}
                value={formatMoney(paid, currency, getLang())}
              />
              <SummaryRow
                label={t().sales.remaining}
                value={formatMoney(remaining, currency, getLang())}
              />
            </div>
            <FormMoney
              name="amount"
              label={`${t().sales.amountReceived} (${currency})`}
              placeholder="0.00"
            />
            {entered > 0 ? (
              <p className="text-sm tabular-nums text-muted-foreground">
                {entered > remaining
                  ? `${t().sales.changeDue}: ${formatMoney(entered - remaining, currency, getLang())}`
                  : `${t().sales.remaining}: ${formatMoney(remaining - entered, currency, getLang())}`}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t().sales.notPaid}
              </p>
            )}
            <FormSelect
              name="method"
              label={t().sales.method}
              options={methodOptions}
              required
            />
            <FormDate
              name="receivedAt"
              label={t().sales.paymentDate}
              max={maxDate}
              required
            />
            <FormInput
              name="note"
              label={t().sales.paymentNote}
              hint={t().sales.paymentNoteHint}
              maxLength={500}
            />
            <DialogFooter className="gap-2">
              <Button
                type="submit"
                disabled={saving || entered <= 0 || remaining <= 0}
              >
                <HugeiconsIcon
                  icon={MoneyAdd01Icon}
                  strokeWidth={2}
                  className="size-4"
                />
                {t().common.save}
              </Button>
              <Button type="button" variant="destructive" onClick={onClose}>
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  strokeWidth={2}
                  className="size-4"
                />
                {t().common.cancel}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
