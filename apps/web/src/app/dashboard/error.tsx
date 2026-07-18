'use client';

import { AppShell } from '../../features/dashboard/components/app-shell';
import { ErrorState } from '../../features/dashboard/components/primitives';

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <AppShell activePath="/dashboard" managerName="Manager">
      <ErrorState
        title="Dashboard unavailable"
        description="The club office could not be loaded. Try refreshing the dashboard."
        action={
          <button className="primary-button" type="button" onClick={reset}>
            Retry
          </button>
        }
      />
    </AppShell>
  );
}
