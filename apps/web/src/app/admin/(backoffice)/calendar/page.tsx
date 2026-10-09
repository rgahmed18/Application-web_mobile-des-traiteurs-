import { Suspense } from 'react';

import { RequirePermission } from '@/features/auth/auth-gates';
import { CalendarView } from '@/features/calendar/calendar-view';

export default function CalendarPage() {
  // useSearchParams (?view=list depuis le tableau de bord) exige une frontière Suspense
  return (
    <RequirePermission permission="calendar.read">
      <Suspense>
        <CalendarView />
      </Suspense>
    </RequirePermission>
  );
}
