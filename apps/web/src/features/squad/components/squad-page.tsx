'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../dashboard/components/app-shell';
import type { PlayerPosition, SquadFilters, SquadPlayer, SquadViewModel } from '../types';
import { BottomSheetFilters } from './bottom-sheet-filters';
import { PlayerCard } from './player-card';
import { PlayerPreview } from './player-preview';
import { PlayerTable } from './player-table';
import { PositionDepthPanel } from './position-depth-panel';
import { SquadFilterBar } from './squad-filter-bar';
import { SquadHeader } from './squad-header';
import { SquadInsights } from './squad-insights';
import { SquadSummary } from './squad-summary';

type SquadPageProps = {
  viewModel: SquadViewModel;
};

const defaultFilters: SquadFilters = {
  search: '',
  position: 'all',
  availability: 'all',
  contract: 'all',
  age: 'all',
  condition: 'all',
  sort: 'rating',
  view: 'table'
};

const positionOrder: PlayerPosition[] = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'];

function getNumericValue(value: string) {
  const normalized = value.replace('EUR ', '').replace('M', '').replace('K', '');
  const amount = Number.parseFloat(normalized);

  if (value.includes('M')) {
    return amount * 1000;
  }

  return amount;
}

function matchesAgeFilter(player: SquadPlayer, age: SquadFilters['age']) {
  if (age === 'under-23') {
    return player.age < 23;
  }

  if (age === 'prime') {
    return player.age >= 23 && player.age <= 29;
  }

  if (age === 'senior') {
    return player.age >= 30;
  }

  return true;
}

function matchesConditionFilter(player: SquadPlayer, condition: SquadFilters['condition']) {
  if (condition === 'ready') {
    return player.condition >= 80;
  }

  if (condition === 'tired') {
    return player.condition >= 60 && player.condition < 80;
  }

  if (condition === 'recovery') {
    return player.condition < 60;
  }

  return true;
}

function filterPlayers(players: SquadPlayer[], filters: SquadFilters) {
  const search = filters.search.trim().toLowerCase();

  return players
    .filter((player) => {
      const searchable = `${player.name} ${player.position} ${player.nationality}`.toLowerCase();

      return (
        (!search || searchable.includes(search)) &&
        (filters.position === 'all' || player.position === filters.position) &&
        (filters.availability === 'all' || player.availability === filters.availability) &&
        (filters.contract === 'all' || player.contractState === filters.contract) &&
        matchesAgeFilter(player, filters.age) &&
        matchesConditionFilter(player, filters.condition)
      );
    })
    .sort((first, second) => {
      if (filters.sort === 'potential') {
        return second.potential - first.potential;
      }

      if (filters.sort === 'position') {
        return positionOrder.indexOf(first.position) - positionOrder.indexOf(second.position);
      }

      if (filters.sort === 'condition') {
        return second.condition - first.condition;
      }

      if (filters.sort === 'value') {
        return getNumericValue(second.marketValue) - getNumericValue(first.marketValue);
      }

      return second.rating - first.rating;
    });
}

export function SquadPage({ viewModel }: SquadPageProps) {
  const [filters, setFilters] = useState<SquadFilters>(defaultFilters);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(viewModel.players[0]?.id ?? null);

  const positions = useMemo<Array<PlayerPosition | 'all'>>(() => {
    const uniquePositions = Array.from(new Set(viewModel.players.map((player) => player.position)));

    return ['all', ...positionOrder.filter((position) => uniquePositions.includes(position))];
  }, [viewModel.players]);

  const visiblePlayers = useMemo(() => filterPlayers(viewModel.players, filters), [viewModel.players, filters]);
  const selectedPlayer = visiblePlayers.find((player) => player.id === selectedPlayerId) ?? visiblePlayers[0] ?? null;
  const activePlayerId = selectedPlayer?.id ?? null;
  const pageClassName = filters.view === 'cards' ? 'squad-page squad-page--cards-view' : 'squad-page';

  return (
    <AppShell activePath="/squad" managerName={viewModel.managerName} mainLabel="Squad management">
      <div className={pageClassName}>
        <SquadHeader club={viewModel.club} />
        <SquadSummary summary={viewModel.summary} />
        <SquadFilterBar filters={filters} positions={positions} idPrefix="desktop-squad" onChange={setFilters} />
        <BottomSheetFilters filters={filters} positions={positions} onChange={setFilters} />

        <div className="squad-layout">
          <section className="game-panel squad-table-panel" aria-label="Player table">
            <PlayerTable players={visiblePlayers} selectedPlayerId={activePlayerId} onSelectPlayer={setSelectedPlayerId} />
            <div className="squad-player-cards" aria-label="Player cards">
              {visiblePlayers.length === 0 ? (
                <div className="squad-empty-state" role="status">
                  <strong>No players found</strong>
                  <p>Adjust filters to bring players back into view.</p>
                </div>
              ) : (
                visiblePlayers.map((player) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    isSelected={player.id === activePlayerId}
                    onSelectPlayer={setSelectedPlayerId}
                  />
                ))
              )}
            </div>
          </section>

          <aside className="squad-side-panel" aria-label="Squad tactical panel">
            <PlayerPreview player={selectedPlayer} />
            <PositionDepthPanel groups={viewModel.positionDepth} />
            <SquadInsights insights={viewModel.insights} />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
