import type { SquadViewModel } from '../types';
import { squadViewModel } from './players';

export async function getSquadViewModel(): Promise<SquadViewModel> {
  return squadViewModel;
}
