'use client';

import {
  type Availability,
  type CatalogSettings,
  EVENT_TYPES,
  type Locale,
  type Order,
  orderEditPolicy,
  type OrderEditPolicy,
} from '@traiteur/shared';
import { InfoIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { FormField } from '@/components/forms/form-field';
import { UnsavedChangesGuard } from '@/components/forms/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/features/auth/session-provider';
import { FormHeader, FormSection } from '@/features/catalog/components/form-layout';
import { useClient } from '@/features/clients/clients-api';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { useZodForm } from '@/lib/forms/use-zod-form';

import {
  availabilityConflict,
  ForceAvailabilityDialog,
  GuestChangeDialog,
  type GuestLineChange,
  isReasonRequired,
  ReasonDialog,
  versionConflict,
  type VersionConflict,
  VersionConflictDialog,
} from '../order-dialogs';
import { useCreateOrder, useUpdateOrder } from '../orders-api';
import { AvailabilityBanner } from './availability-banner';
import { ClientPicker } from './client-picker';
import { LinesEditor } from './lines-editor';
import {
  emptyOrderForm,
  type OrderFormOutput,
  orderFormSchema,
  orderToFormValues,
} from './order-form-schema';
import { TotalsPanel } from './totals-panel';

type Intent = 'DRAFT' | 'PENDING' | 'CONFIRMED';

interface SendOptions {
  forceAvailability?: boolean;
  reason?: string | null;
}

interface OrderFormProps {
  settings: CatalogSettings;
  order?: Order;
  initialDate: string;
  initialClientId: string;
  /** Recharge la commande (conflit de version) : le formulaire est recréé avec la dernière version. */
  onReload?: () => void;
}

const OPEN_POLICY: OrderEditPolicy = orderEditPolicy('PENDING');

export function OrderForm({
  settings,
  order,
  initialDate,
  initialClientId,
  onReload,
}: OrderFormProps) {
  const tc = useTranslations('common');
  const tf = useTranslations('orders.form');
  const tEvent = useTranslations('eventType');
  const tStatus = useTranslations('orderStatus');
  const router = useRouter();
  const can = usePermission();
  const describeError = useErrorMessage();
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();

  const priceMode = order?.priceMode ?? settings.priceEntryMode;
  const policy = order ? orderEditPolicy(order.status) : OPEN_POLICY;
  const locked = {
    client: policy.client === 'locked',
    date: policy.date === 'locked',
    framed: policy.framed === 'locked',
    free: policy.free === 'locked',
  };

  const form = useZodForm(
    orderFormSchema,
    order ? orderToFormValues(order) : emptyOrderForm(initialDate, initialClientId),
  );
  const [clientId, eventDate, endTime, lines] = useWatch({
    control: form.control,
    name: ['clientId', 'eventDate', 'endTime', 'lines'],
  });
  const client = useClient(clientId === '' ? null : clientId);
  const labelLocale: Locale = client.data?.locale ?? 'fr';

  const [saved, setSaved] = useState(false);
  const [forceRequest, setForceRequest] = useState<{
    availability: Availability;
    retry: () => void;
  } | null>(null);
  const [reasonRequest, setReasonRequest] = useState<((reason: string) => void) | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [guestChange, setGuestChange] = useState<{
    from: number;
    to: number;
    lines: GuestLineChange[];
  } | null>(null);
  const guestsRef = useRef<number | null>(order?.guestCount ?? null);

  // Nouvelle commande : le lieu reprend l'adresse par défaut du client choisi (si vide)
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    const data = client.data;
    if (order || !data || prefilledFor.current === data.id) return;
    prefilledFor.current = data.id;
    const address = data.addresses.find((item) => item.isDefault) ?? data.addresses[0];
    if (address && form.getValues('venueAddress').trim() === '') {
      form.setValue('venueAddress', address.address, { shouldDirty: true });
      form.setValue('city', address.city, { shouldDirty: true });
    }
  }, [client.data, form, order]);

  /** Nombre d'invités confirmé (sortie du champ) : proposer d'ajuster les lignes par personne. */
  const onGuestsCommitted = (value: string) => {
    if (!/^\d+$/.test(value.trim())) return;
    const to = Number(value);
    const from = guestsRef.current;
    guestsRef.current = to;
    if (from === null || from === to) return;
    const perPerson = form
      .getValues('lines')
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) => line.perPerson && /^\d+$/.test(line.quantity) && Number(line.quantity) !== to,
      );
    if (perPerson.length === 0) return;
    setGuestChange({
      from,
      to,
      lines: perPerson.map(({ line, index }) => ({
        index,
        label: line.label,
        from: Number(line.quantity),
      })),
    });
  };

  const send = async (values: OrderFormOutput, options: SendOptions): Promise<void> => {
    try {
      let result: Order;
      if (order) {
        const { status: _status, forceAvailability: _force, ...fields } = values;
        result = await updateOrder.mutateAsync({
          id: order.id,
          input: {
            ...fields,
            version: order.version,
            reason: options.reason ?? null,
            forceAvailability: options.forceAvailability ?? false,
          },
        });
        toast.success(tf('saved'));
      } else {
        result = await createOrder.mutateAsync({
          ...values,
          forceAvailability: options.forceAvailability ?? false,
        });
        toast.success(tf('created', { reference: result.reference }));
      }
      setSaved(true);
      router.push(`/admin/orders/${result.id}`);
    } catch (error) {
      const availability = availabilityConflict(error);
      if (availability) {
        setForceRequest({
          availability,
          retry: () => void send(values, { ...options, forceAvailability: true }),
        });
        return;
      }
      if (isReasonRequired(error)) {
        setReasonRequest(() => (reason: string) => void send(values, { ...options, reason }));
        return;
      }
      const stale = versionConflict(error);
      if (stale) {
        setConflict(stale);
        return;
      }
      toast.error(describeError(error));
    }
  };

  const submit = (intent: Intent) => {
    form.setValue('status', intent);
    return form.handleSubmit((values) => send(values, {}))();
  };

  const statusHint = !order
    ? null
    : order.status === 'CONFIRMED'
      ? tf('confirmedHint')
      : order.status === 'IN_PREPARATION'
        ? tf('preparationHint')
        : locked.free
          ? tf('readOnlyHint', { status: tStatus(order.status) })
          : null;
  const busy = form.formState.isSubmitting || createOrder.isPending || updateOrder.isPending;
  const backHref = order ? `/admin/orders/${order.id}` : '/admin/orders';
  const clientError = form.formState.errors.clientId?.message;

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(order ? (order.status === 'DRAFT' ? 'DRAFT' : 'PENDING') : 'PENDING');
      }}
    >
      <UnsavedChangesGuard when={form.formState.isDirty && !saved} />
      <FormHeader
        title={order ? tf('editTitle', { reference: order.reference }) : tf('newTitle')}
        backHref={backHref}
      />
      {statusHint && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3">
          <InfoIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          {statusHint}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <FormSection title={tf('sections.client')}>
            <Controller
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <ClientPicker
                  value={field.value}
                  onChange={(id) => {
                    field.onChange(id);
                    void form.trigger('clientId');
                  }}
                  disabled={locked.client}
                  invalid={Boolean(clientError)}
                />
              )}
            />
            {clientError && <FieldError>{tf('client.required')}</FieldError>}
          </FormSection>

          <FormSection title={tf('sections.event')}>
            <FormField
              control={form.control}
              name="eventType"
              label={tf('event.type')}
              render={(field) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={locked.framed}>
                  <SelectTrigger id={field.id} className="w-full sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {tEvent(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="eventDate"
                label={tf('event.date')}
                render={(field, { invalid }) => (
                  <Input
                    {...field}
                    type="date"
                    dir="ltr"
                    disabled={locked.date}
                    aria-invalid={invalid}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="startTime"
                label={tf('event.startTime')}
                render={(field, { invalid }) => (
                  <Input
                    {...field}
                    type="time"
                    dir="ltr"
                    disabled={locked.date}
                    aria-invalid={invalid}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="endTime"
                label={tf('event.endTime')}
                render={(field, { invalid }) => (
                  <Input
                    {...field}
                    type="time"
                    dir="ltr"
                    disabled={locked.date}
                    aria-invalid={invalid}
                  />
                )}
              />
            </div>
            {endTime !== '' && (
              <Controller
                control={form.control}
                name="endsNextDay"
                render={({ field }) => (
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={field.value}
                      disabled={locked.date}
                      onCheckedChange={(checked) => {
                        field.onChange(checked === true);
                        void form.trigger('endTime');
                      }}
                    />
                    {tf('event.endsNextDay')}
                  </label>
                )}
              />
            )}
            {!locked.date && <AvailabilityBanner date={eventDate} orderId={order?.id} />}
            <FormField
              control={form.control}
              name="guestCount"
              label={tf('event.guests')}
              render={(field, { invalid }) => (
                <Input
                  {...field}
                  inputMode="numeric"
                  dir="ltr"
                  className="sm:w-40"
                  disabled={locked.framed}
                  aria-invalid={invalid}
                  onBlur={(event) => {
                    field.onBlur();
                    onGuestsCommitted(event.target.value);
                  }}
                />
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="venueName"
                label={tf('event.venueName')}
                render={(field, { invalid }) => (
                  <Input {...field} disabled={locked.free} aria-invalid={invalid} />
                )}
              />
              {client.data && client.data.addresses.length > 0 && !locked.framed && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{tf('event.useAddress')}</span>
                  <Select
                    value=""
                    onValueChange={(id) => {
                      const address = client.data?.addresses.find((item) => item.id === id);
                      if (!address) return;
                      form.setValue('venueAddress', address.address, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue('city', address.city, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label={tf('event.useAddress')}>
                      <SelectValue placeholder={tf('event.useAddress')} />
                    </SelectTrigger>
                    <SelectContent>
                      {client.data.addresses.map((address) => (
                        <SelectItem key={address.id} value={address.id}>
                          {address.label} — {address.city}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <FormField
                control={form.control}
                name="venueAddress"
                label={tf('event.venueAddress')}
                render={(field, { invalid }) => (
                  <Input {...field} disabled={locked.framed} aria-invalid={invalid} />
                )}
              />
              <FormField
                control={form.control}
                name="city"
                label={tf('event.city')}
                render={(field, { invalid }) => (
                  <Input {...field} disabled={locked.framed} aria-invalid={invalid} />
                )}
              />
            </div>
          </FormSection>

          <FormSection title={tf('sections.lines')}>
            <LinesEditor
              control={form.control}
              priceMode={priceMode}
              isVatRegistered={settings.isVatRegistered}
              defaultTaxRateBps={settings.defaultTaxRateBps}
              labelLocale={labelLocale}
              disabled={locked.framed}
            />
          </FormSection>

          <FormSection title={tf('sections.notes')}>
            <FormField
              control={form.control}
              name="notes"
              label={tf('notes.client')}
              description={tf('notes.clientHint')}
              render={(field, { invalid }) => (
                <Textarea {...field} rows={3} disabled={locked.free} aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="internalNotes"
              label={tf('notes.internal')}
              description={tf('notes.internalHint')}
              render={(field, { invalid }) => (
                <Textarea {...field} rows={3} aria-invalid={invalid} />
              )}
            />
          </FormSection>
        </div>

        <div className="lg:sticky lg:top-4">
          <TotalsPanel
            control={form.control}
            setValue={form.setValue}
            priceMode={priceMode}
            disabled={locked.framed || lines.length === 0}
          />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button asChild variant="outline" size="lg">
          <Link href={backHref}>{tc('cancel')}</Link>
        </Button>
        {order ? (
          <Button type="submit" size="lg" disabled={busy}>
            {tf('actions.save')}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={busy}
              onClick={() => void submit('DRAFT')}
            >
              {tf('actions.saveDraft')}
            </Button>
            <Button
              type="submit"
              size="lg"
              variant={can('orders.write') ? 'outline' : 'default'}
              disabled={busy}
            >
              {tf('actions.savePending')}
            </Button>
            {can('orders.write') && (
              <Button
                type="button"
                size="lg"
                disabled={busy}
                onClick={() => void submit('CONFIRMED')}
              >
                {tf('actions.saveConfirm')}
              </Button>
            )}
          </>
        )}
      </div>

      <ForceAvailabilityDialog
        availability={forceRequest?.availability ?? null}
        onCancel={() => setForceRequest(null)}
        onConfirm={() => {
          const retry = forceRequest?.retry;
          setForceRequest(null);
          retry?.();
        }}
      />
      <ReasonDialog
        open={reasonRequest !== null}
        title={tf('reason.title')}
        description={tf('reason.description')}
        label={tf('reason.label')}
        placeholder={tf('reason.placeholder')}
        confirmLabel={tf('reason.confirm')}
        pending={busy}
        onCancel={() => setReasonRequest(null)}
        onConfirm={(reason) => {
          const retry = reasonRequest;
          setReasonRequest(null);
          retry?.(reason);
        }}
      />
      <VersionConflictDialog
        conflict={conflict}
        timeZone={settings.timezone}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          setSaved(true);
          onReload?.();
        }}
      />
      <GuestChangeDialog
        change={guestChange}
        onSkip={() => setGuestChange(null)}
        onApply={(indexes) => {
          const to = guestChange?.to;
          if (to !== undefined) {
            for (const index of indexes) {
              form.setValue(`lines.${index}.quantity`, String(to), {
                shouldDirty: true,
                shouldValidate: true,
              });
            }
          }
          setGuestChange(null);
        }}
      />
    </form>
  );
}
