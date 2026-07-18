import { AppShell } from '../../features/dashboard/components/app-shell';
import { DashboardSkeleton } from '../../features/dashboard/components/primitives';

export default function DashboardLoading() {
  return (
    <AppShell activePath="/dashboard" managerName="Loading">
      <DashboardSkeleton />
    </AppShell>
  );
}
