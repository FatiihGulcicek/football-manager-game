import { ChevronDown, Filter } from 'lucide-react';
import type { PlayerPosition, SquadFilters } from '../types';
import { SquadFilterControls } from './squad-filter-bar';

type BottomSheetFiltersProps = {
  filters: SquadFilters;
  positions: Array<PlayerPosition | 'all'>;
  onChange: (filters: SquadFilters) => void;
};

export function BottomSheetFilters({ filters, positions, onChange }: BottomSheetFiltersProps) {
  return (
    <details className="bottom-sheet-filters">
      <summary className="bottom-sheet-filters__trigger" aria-label="Open squad filters">
        <Filter aria-hidden="true" size={18} />
        <span>Filters</span>
        <ChevronDown aria-hidden="true" size={18} />
      </summary>
      <div className="bottom-sheet-filters__panel" aria-label="Squad filter sheet">
        <div className="bottom-sheet-filters__handle" aria-hidden="true" />
        <SquadFilterControls filters={filters} positions={positions} idPrefix="mobile-squad" onChange={onChange} />
      </div>
    </details>
  );
}
