import { Search } from 'lucide-react';
import type { PlayerAvailability, PlayerPosition, SquadContractState, SquadFilters } from '../types';

type SquadFilterControlsProps = {
  filters: SquadFilters;
  positions: Array<PlayerPosition | 'all'>;
  idPrefix: string;
  onChange: (filters: SquadFilters) => void;
};

const availabilityOptions: Array<PlayerAvailability | 'all'> = [
  'all',
  'Available',
  'Injured',
  'Suspended',
  'Unavailable',
  'Loan'
];

const contractOptions: Array<SquadContractState | 'all'> = ['all', 'Stable', 'Expiring', 'Long'];

function formatOptionLabel(value: string) {
  if (value === 'all') {
    return 'All';
  }

  if (value === 'under-23') {
    return 'Under 23';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function SquadFilterControls({ filters, positions, idPrefix, onChange }: SquadFilterControlsProps) {
  return (
    <div className="squad-filter-controls">
      <label className="squad-filter-field squad-filter-field--search" htmlFor={`${idPrefix}-search`}>
        <span>Search</span>
        <div className="squad-search-control">
          <Search aria-hidden="true" size={16} />
          <input
            id={`${idPrefix}-search`}
            type="search"
            placeholder="Search squad"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
          />
        </div>
      </label>

      <label className="squad-filter-field" htmlFor={`${idPrefix}-position`}>
        <span>Position</span>
        <select
          id={`${idPrefix}-position`}
          value={filters.position}
          onChange={(event) => onChange({ ...filters, position: event.target.value as SquadFilters['position'] })}
        >
          {positions.map((position) => (
            <option key={position} value={position}>
              {position === 'all' ? 'All positions' : position}
            </option>
          ))}
        </select>
      </label>

      <label className="squad-filter-field" htmlFor={`${idPrefix}-availability`}>
        <span>Availability</span>
        <select
          id={`${idPrefix}-availability`}
          value={filters.availability}
          onChange={(event) =>
            onChange({ ...filters, availability: event.target.value as SquadFilters['availability'] })
          }
        >
          {availabilityOptions.map((availability) => (
            <option key={availability} value={availability}>
              {availability === 'all' ? 'All availability' : availability}
            </option>
          ))}
        </select>
      </label>

      <label className="squad-filter-field" htmlFor={`${idPrefix}-contract`}>
        <span>Contract</span>
        <select
          id={`${idPrefix}-contract`}
          value={filters.contract}
          onChange={(event) => onChange({ ...filters, contract: event.target.value as SquadFilters['contract'] })}
        >
          {contractOptions.map((contract) => (
            <option key={contract} value={contract}>
              {contract === 'all' ? 'All contracts' : contract}
            </option>
          ))}
        </select>
      </label>

      <label className="squad-filter-field" htmlFor={`${idPrefix}-age`}>
        <span>Age</span>
        <select
          id={`${idPrefix}-age`}
          value={filters.age}
          onChange={(event) => onChange({ ...filters, age: event.target.value as SquadFilters['age'] })}
        >
          {['all', 'under-23', 'prime', 'senior'].map((age) => (
            <option key={age} value={age}>
              {age === 'all' ? 'All ages' : formatOptionLabel(age)}
            </option>
          ))}
        </select>
      </label>

      <label className="squad-filter-field" htmlFor={`${idPrefix}-condition`}>
        <span>Condition</span>
        <select
          id={`${idPrefix}-condition`}
          value={filters.condition}
          onChange={(event) => onChange({ ...filters, condition: event.target.value as SquadFilters['condition'] })}
        >
          {['all', 'ready', 'tired', 'recovery'].map((condition) => (
            <option key={condition} value={condition}>
              {condition === 'all' ? 'All condition' : formatOptionLabel(condition)}
            </option>
          ))}
        </select>
      </label>

      <label className="squad-filter-field" htmlFor={`${idPrefix}-sort`}>
        <span>Sort</span>
        <select
          id={`${idPrefix}-sort`}
          value={filters.sort}
          onChange={(event) => onChange({ ...filters, sort: event.target.value as SquadFilters['sort'] })}
        >
          {['rating', 'potential', 'position', 'condition', 'value'].map((sort) => (
            <option key={sort} value={sort}>
              {formatOptionLabel(sort)}
            </option>
          ))}
        </select>
      </label>

      <label className="squad-filter-field" htmlFor={`${idPrefix}-view`}>
        <span>View</span>
        <select
          id={`${idPrefix}-view`}
          value={filters.view}
          onChange={(event) => onChange({ ...filters, view: event.target.value as SquadFilters['view'] })}
        >
          <option value="table">Table</option>
          <option value="cards">Cards</option>
        </select>
      </label>
    </div>
  );
}

export function SquadFilterBar(props: SquadFilterControlsProps) {
  return (
    <section className="squad-filter-bar" aria-label="Squad filters">
      <SquadFilterControls {...props} />
    </section>
  );
}
