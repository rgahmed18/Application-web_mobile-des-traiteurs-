'use client';

import { PlusIcon, SearchIcon, UserRoundIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { ClientFormDialog } from '@/features/clients/client-form-dialog';
import { clientName, useClient, useClients } from '@/features/clients/clients-api';

interface ClientPickerProps {
  value: string;
  onChange: (clientId: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

/** Recherche d'un client par nom ou téléphone, ou création rapide sans quitter la commande. */
export function ClientPicker({ value, onChange, disabled, invalid }: ClientPickerProps) {
  const t = useTranslations('orders.form.client');
  const canCreate = usePermission()('clients.write');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim());
  const results = useClients({ search: debounced || undefined, pageSize: 20 }, open);
  const selected = useClient(value === '' ? null : value);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="flex flex-col gap-3">
      {value !== '' && (
        <div
          className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3"
          data-testid="selected-client"
        >
          <UserRoundIcon className="size-5 text-muted-foreground" aria-hidden />
          {selected.data ? (
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{clientName(selected.data)}</p>
              <p className="text-sm text-muted-foreground" dir="ltr">
                {selected.data.phone}
              </p>
            </div>
          ) : (
            <Skeleton className="h-10 flex-1" />
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={value === '' ? 'default' : 'outline'}
              disabled={disabled}
              aria-invalid={invalid}
            >
              <SearchIcon aria-hidden />
              {value === '' ? t('search') : t('change')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder={t('search')}
                value={search}
                onValueChange={setSearch}
                className="h-11 text-base"
              />
              <CommandList>
                <CommandEmpty>{t('noResult')}</CommandEmpty>
                <CommandGroup>
                  {(results.data?.items ?? []).map((client) => (
                    <CommandItem
                      key={client.id}
                      value={client.id}
                      className="flex-col items-start gap-0 py-2"
                      onSelect={() => choose(client.id)}
                    >
                      <span className="font-medium">{clientName(client)}</span>
                      <span className="text-sm text-muted-foreground" dir="ltr">
                        {client.phone}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {canCreate && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => setCreating(true)}
          >
            <PlusIcon aria-hidden />
            {t('newClient')}
          </Button>
        )}
      </div>
      {disabled && value !== '' && <p className="text-sm text-muted-foreground">{t('locked')}</p>}
      {creating && (
        <ClientFormDialog
          onClose={() => setCreating(false)}
          onSaved={(client) => choose(client.id)}
          onExisting={(id) => {
            choose(id);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
