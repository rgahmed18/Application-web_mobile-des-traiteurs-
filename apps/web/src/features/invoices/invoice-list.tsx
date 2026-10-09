'use client';

import { type InvoiceType, todayInTimeZone } from '@traiteur/shared';
import { FileSpreadsheetIcon, FileTextIcon, ReceiptTextIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState, PaginationBar } from '@/components/layout/list-states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { openDocument } from '@/features/payments/payments-api';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

import { exportInvoices, useInvoices } from './invoices-api';
import { useInvoiceTitle } from './invoices-card';

const PAGE_SIZE = 20;
const ALL = 'all';

/** Factures et avoirs émis : recherche, période, type, PDF et export comptable. */
export function InvoiceList() {
  const t = useTranslations('invoices');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const describeError = useErrorMessage();
  const title = useInvoiceTitle();
  const today = todayInTimeZone(timeZone);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  // Sans date de fin par défaut : une facture tout juste émise reste visible
  const [to, setTo] = useState('');
  const [type, setType] = useState<InvoiceType | typeof ALL>(ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());

  const filters = {
    from: from || undefined,
    to: to || undefined,
    type: type === ALL ? undefined : type,
    search: debouncedSearch || undefined,
  };
  const invoices = useInvoices({ ...filters, page, pageSize: PAGE_SIZE });
  const items = invoices.data?.items ?? [];

  const runExport = async (format: 'xlsx' | 'csv') => {
    setExporting(format);
    try {
      await exportInvoices({ ...filters, format });
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('listTitle')}
        description={t('listSubtitle')}
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              disabled={exporting !== null}
              onClick={() => void runExport('xlsx')}
            >
              <FileSpreadsheetIcon aria-hidden />
              {t('export.xlsx')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={exporting !== null}
              onClick={() => void runExport('csv')}
            >
              <FileTextIcon aria-hidden />
              {t('export.csv')}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] lg:items-end">
        <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="invoice-search">{t('search')}</Label>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              id="invoice-search"
              type="search"
              value={search}
              placeholder={t('searchHint')}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </InputGroup>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-from">{t('from')}</Label>
          <Input
            id="invoice-from"
            type="date"
            dir="ltr"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-to">{t('to')}</Label>
          <Input
            id="invoice-to"
            type="date"
            dir="ltr"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-type">{t('type')}</Label>
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value as InvoiceType | typeof ALL);
              setPage(1);
            }}
          >
            <SelectTrigger id="invoice-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('types.all')}</SelectItem>
              <SelectItem value="INVOICE">{t('types.INVOICE')}</SelectItem>
              <SelectItem value="CREDIT_NOTE">{t('types.CREDIT_NOTE')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {invoices.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ReceiptTextIcon}
          title={t('listEmpty')}
          description={t('listEmptyHint')}
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="invoice-list">
          {items.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {title(invoice)}{' '}
                  <span dir="ltr" className="text-muted-foreground">
                    {invoice.number}
                  </span>
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  <span dir="auto">{invoice.clientName}</span>
                  {invoice.clientIce && (
                    <>
                      {' · ICE '}
                      <span dir="ltr">{invoice.clientIce}</span>
                    </>
                  )}
                  {' · '}
                  <Link
                    href={`/admin/orders/${invoice.orderId}`}
                    className="underline-offset-2 hover:underline"
                    dir="ltr"
                  >
                    {invoice.orderReference}
                  </Link>
                </p>
              </div>
              <dl className="grid grid-cols-3 gap-x-4 text-sm sm:w-[26rem] sm:text-end">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('columns.date')}</dt>
                  <dd dir="ltr">{formatLocalDate(invoice.issuedOn)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('columns.ht')}</dt>
                  <dd className="tabular-nums" dir="ltr">
                    {formatMoney(invoice.totalHt, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('columns.ttc')}</dt>
                  <dd
                    className={cn(
                      'font-semibold tabular-nums',
                      invoice.totalTtc < 0 && 'text-red-700 dark:text-red-300',
                    )}
                    dir="ltr"
                  >
                    {formatMoney(invoice.totalTtc, locale)}
                  </dd>
                </div>
              </dl>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  openDocument(`/invoices/${invoice.id}/pdf`).catch((error: unknown) =>
                    toast.error(describeError(error)),
                  )
                }
              >
                <FileTextIcon aria-hidden />
                PDF
              </Button>
            </li>
          ))}
        </ul>
      )}

      {invoices.data && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={invoices.data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
