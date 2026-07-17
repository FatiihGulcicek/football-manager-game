import { DashboardView } from '../../features/dashboard/components/dashboard-view';
import { getDashboardViewModel } from '../../features/dashboard/data/dashboard-data';

export default async function DashboardPage() {
  const viewModel = await getDashboardViewModel();

  return <DashboardView viewModel={viewModel} />;
}
