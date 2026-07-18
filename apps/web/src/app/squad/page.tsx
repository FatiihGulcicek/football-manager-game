import { SquadPage } from '../../features/squad/components/squad-page';
import { getSquadViewModel } from '../../features/squad/data/squad-data';

export default async function SquadRoute() {
  const viewModel = await getSquadViewModel();

  return <SquadPage viewModel={viewModel} />;
}
