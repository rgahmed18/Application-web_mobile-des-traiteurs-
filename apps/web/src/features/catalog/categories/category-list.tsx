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
import type { Category } from '@traiteur/shared';
import { FolderTreeIcon, GripVerticalIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/features/auth/session-provider';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { cn } from '@/lib/utils';

import { useCategories, useReorderCategories, useSaveCategory } from '../catalog-api';
import { CatalogHeader } from '../components/catalog-header';
import { EmptyState, StatusBadge } from '../components/catalog-ui';
import { useLocalized } from '../use-localized';
import { CategoryFormDialog } from './category-form';

interface RowProps {
  category: Category;
  canWrite: boolean;
  onEdit: () => void;
  onToggle: (isActive: boolean) => void;
}

function CategoryRow({ category, canWrite, onEdit, onToggle }: RowProps) {
  const t = useTranslations('catalog');
  const localized = useLocalized();
  const name = localized(category.name);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id, disabled: !canWrite });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 bg-card p-3 sm:p-4',
        isDragging && 'relative z-10 rounded-lg shadow-lg ring-2 ring-ring',
      )}
    >
      {canWrite && (
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          size="icon"
          className="cursor-grab touch-none active:cursor-grabbing"
          aria-label={t('categories.dragHandle', { name })}
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon aria-hidden />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium">{name}</p>
        <p className="text-sm text-muted-foreground">
          {t('categories.dishCount', { count: category.dishCount })}
        </p>
      </div>
      {category.isActive ? (
        <StatusBadge tone="success">{t('status.active')}</StatusBadge>
      ) : (
        <StatusBadge tone="warning">{t('status.inactive')}</StatusBadge>
      )}
      {canWrite && (
        <>
          <Switch
            checked={category.isActive}
            onCheckedChange={onToggle}
            aria-label={`${t('categories.active')} — ${name}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t('actions.edit')} — ${name}`}
            onClick={onEdit}
          >
            <PencilIcon aria-hidden />
          </Button>
        </>
      )}
    </li>
  );
}

type Editing = { category?: Category } | null;

/** Catégories dans l'ordre d'affichage ; glisser-déposer à la souris, au doigt ou au clavier. */
export function CategoryList() {
  const t = useTranslations('catalog');
  const localized = useLocalized();
  const describeError = useErrorMessage();
  const canWrite = usePermission()('catalog.write');
  const categories = useCategories();
  const reorder = useReorderCategories();
  const save = useSaveCategory();
  const [editing, setEditing] = useState<Editing>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = categories.data ?? [];
  const nameOf = (id: string | number) => {
    const category = items.find((item) => item.id === id);
    return category ? localized(category.name) : '';
  };
  const positionOf = (id: string | number) => items.findIndex((item) => item.id === id) + 1;

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
      onSuccess: () => toast.success(t('categories.orderSaved')),
      onError: (error) => toast.error(describeError(error)),
    });
  };

  const toggle = (category: Category, isActive: boolean) =>
    save.mutate(
      {
        id: category.id,
        input: { name: category.name, description: category.description, isActive },
      },
      {
        onSuccess: () => toast.success(t('categories.saved')),
        onError: (error) => toast.error(describeError(error)),
      },
    );

  return (
    <div className="flex flex-col gap-6">
      <CatalogHeader
        action={
          canWrite && (
            <Button size="lg" onClick={() => setEditing({})}>
              <PlusIcon aria-hidden />
              {t('categories.new')}
            </Button>
          )
        }
      />

      {categories.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={FolderTreeIcon}
          title={t('categories.empty')}
          description={t('categories.emptyHint')}
          action={
            canWrite && (
              <Button size="lg" onClick={() => setEditing({})}>
                {t('categories.new')}
              </Button>
            )
          }
        />
      ) : (
        <>
          {canWrite && <p className="text-muted-foreground">{t('categories.dragHint')}</p>}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: { draggable: t('categories.dragHint') },
            }}
          >
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul
                className="flex flex-col divide-y overflow-hidden rounded-xl border"
                data-testid="category-list"
              >
                {items.map((category) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    canWrite={canWrite}
                    onEdit={() => setEditing({ category })}
                    onToggle={(isActive) => toggle(category, isActive)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      {editing && (
        <CategoryFormDialog
          key={editing.category?.id ?? 'new'}
          category={editing.category}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
