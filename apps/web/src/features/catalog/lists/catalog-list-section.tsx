'use client';

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CatalogList, CatalogListItem } from '@traiteur/shared';
import { GripVerticalIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { cn } from '@/lib/utils';

import {
  useArchiveCatalogListItem,
  useCatalogList,
  useDeleteCatalogListItem,
  useReorderCatalogList,
} from '../catalog-api';
import { StatusBadge } from '../components/catalog-ui';
import { ItemActionsMenu } from '../components/item-actions';
import { useLocalized } from '../use-localized';
import { CatalogListFormDialog } from './catalog-list-form';

interface RowProps {
  list: CatalogList;
  item: CatalogListItem;
  canWrite: boolean;
  onEdit: () => void;
}

function ListRow({ list, item, canWrite, onEdit }: RowProps) {
  const t = useTranslations('catalog');
  const localized = useLocalized();
  const archive = useArchiveCatalogListItem(list);
  const remove = useDeleteCatalogListItem(list);
  const name = localized(item.name);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canWrite });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 bg-card p-3 sm:p-4',
        isDragging && 'relative z-10 rounded-lg shadow-lg ring-2 ring-ring',
      )}
      data-testid="catalog-list-item"
    >
      {canWrite && (
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          size="icon"
          className="cursor-grab touch-none active:cursor-grabbing"
          aria-label={t('lists.dragHandle', { name })}
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon aria-hidden />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn('truncate text-base font-medium', item.archived && 'text-muted-foreground')}
        >
          {name}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('lists.usage', { count: item.usageCount })}
          <span className="hidden sm:inline" dir="ltr">
            {' · '}
            {item.code}
          </span>
        </p>
      </div>
      {item.archived ? (
        <StatusBadge tone="muted">{t('lists.archived')}</StatusBadge>
      ) : item.isActive ? (
        <StatusBadge tone="success">{t('status.active')}</StatusBadge>
      ) : (
        <StatusBadge tone="warning">{t('status.inactive')}</StatusBadge>
      )}
      {canWrite && (
        <ItemActionsMenu
          name={name}
          archived={item.archived}
          inUse={item.usageCount > 0}
          onEdit={onEdit}
          perform={(action) =>
            action === 'delete'
              ? remove.mutateAsync(item.id)
              : archive.mutateAsync({ id: item.id, archived: action === 'archive' })
          }
          pending={archive.isPending || remove.isPending}
        />
      )}
    </li>
  );
}

type Editing = { item?: CatalogListItem } | null;

/** Une liste gérable : ordre par glisser-déposer, ajout, modification, archivage. */
export function CatalogListSection({ list }: { list: CatalogList }) {
  const t = useTranslations('catalog');
  const localized = useLocalized();
  const describeError = useErrorMessage();
  const canWrite = usePermission()('catalog.write');
  const query = useCatalogList(list);
  const reorder = useReorderCatalogList(list);
  const [editing, setEditing] = useState<Editing>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const items = query.data ?? [];
  const nameOf = (id: string | number) => {
    const item = items.find((entry) => entry.id === id);
    return item ? localized(item.name) : '';
  };
  const positionOf = (id: string | number) => items.findIndex((entry) => entry.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('categories.dragStart', { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('categories.dragOver', { name: nameOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t('categories.dragEnd', { name: nameOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragCancel: () => t('categories.dragCancel'),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = items.map((item) => item.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    reorder.mutate(next, {
      onSuccess: () => toast.success(t('lists.orderSaved')),
      onError: (error) => toast.error(describeError(error)),
    });
  };

  return (
    <Card data-testid={`catalog-list-${list}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-lg">{t(`lists.sections.${list}.title`)}</CardTitle>
          <CardDescription>{t(`lists.sections.${list}.hint`)}</CardDescription>
        </div>
        {canWrite && (
          <Button onClick={() => setEditing({})}>
            <PlusIcon aria-hidden />
            {t('lists.newItem')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">{t('lists.empty')}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: { draggable: t('lists.dragHint') },
            }}
          >
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col divide-y overflow-hidden rounded-xl border">
                {items.map((item) => (
                  <ListRow
                    key={item.id}
                    list={list}
                    item={item}
                    canWrite={canWrite}
                    onEdit={() => setEditing({ item })}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
      {editing && (
        <CatalogListFormDialog
          key={editing.item?.id ?? 'new'}
          list={list}
          item={editing.item}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
