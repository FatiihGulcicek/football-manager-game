import { Crown, ShieldCheck } from 'lucide-react';
import type { SquadPlayer } from '../types';
import { ConditionMeter } from './condition-meter';
import { MoraleIndicator } from './morale-indicator';
import { StatusBadge } from './status-badge';

type PlayerTableProps = {
  players: SquadPlayer[];
  selectedPlayerId: string | null;
  onSelectPlayer: (playerId: string) => void;
};

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function LeadershipMarkers({ player }: { player: SquadPlayer }) {
  return (
    <span className="squad-leadership-markers">
      {player.isCaptain ? (
        <span className="squad-leadership-marker" aria-label="Captain">
          <Crown aria-hidden="true" size={13} />
          C
        </span>
      ) : null}
      {player.isViceCaptain ? (
        <span className="squad-leadership-marker" aria-label="Vice captain">
          <ShieldCheck aria-hidden="true" size={13} />
          VC
        </span>
      ) : null}
    </span>
  );
}

export function PlayerTable({ players, selectedPlayerId, onSelectPlayer }: PlayerTableProps) {
  return (
    <div className="player-table-scroll" aria-label="Scrollable player table">
      <table className="squad-player-table">
        <caption className="sr-only">First team squad list</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Position</th>
            <th scope="col">Age</th>
            <th className="squad-col--tablet-optional" scope="col">
              Nationality
            </th>
            <th scope="col">Rating</th>
            <th scope="col">Potential</th>
            <th scope="col">Condition</th>
            <th className="squad-col--tablet-optional" scope="col">
              Sharpness
            </th>
            <th scope="col">Morale</th>
            <th className="squad-col--tablet-optional" scope="col">
              Apps
            </th>
            <th className="squad-col--tablet-optional" scope="col">
              Goals
            </th>
            <th className="squad-col--tablet-optional" scope="col">
              Assists
            </th>
            <th scope="col">Contract</th>
            <th className="squad-col--tablet-optional" scope="col">
              Weekly Wage
            </th>
            <th scope="col">Market Value</th>
            <th scope="col">Availability</th>
          </tr>
        </thead>
        <tbody>
          {players.length === 0 ? (
            <tr>
              <td colSpan={16}>
                <div className="squad-table-empty" role="status">
                  No players found
                </div>
              </td>
            </tr>
          ) : (
            players.map((player) => {
              const isSelected = selectedPlayerId === player.id;

              return (
                <tr key={player.id} className={isSelected ? 'is-selected' : undefined} aria-selected={isSelected}>
                  <th scope="row">
                    <button
                      className="squad-player-cell"
                      type="button"
                      aria-label={`Select ${player.name}`}
                      aria-pressed={isSelected}
                      onClick={() => onSelectPlayer(player.id)}
                    >
                      <span className="squad-player-avatar" aria-hidden="true">
                        {getInitials(player.name)}
                      </span>
                      <span className="squad-player-name">
                        <strong>{player.name}</strong>
                        <small>
                          #{player.shirtNumber}
                          <LeadershipMarkers player={player} />
                        </small>
                      </span>
                    </button>
                  </th>
                  <td>
                    <span className="squad-position-pill">{player.position}</span>
                  </td>
                  <td>{player.age}</td>
                  <td className="squad-col--tablet-optional">{player.nationality}</td>
                  <td>
                    <strong>{player.rating}</strong>
                  </td>
                  <td>{player.potential}</td>
                  <td>
                    <ConditionMeter value={player.condition} label={`${player.name} condition`} />
                  </td>
                  <td className="squad-col--tablet-optional">{player.sharpness}%</td>
                  <td>
                    <MoraleIndicator morale={player.morale} />
                  </td>
                  <td className="squad-col--tablet-optional">{player.appearances}</td>
                  <td className="squad-col--tablet-optional">{player.goals}</td>
                  <td className="squad-col--tablet-optional">{player.assists}</td>
                  <td>{player.contract}</td>
                  <td className="squad-col--tablet-optional">{player.weeklyWage}</td>
                  <td>{player.marketValue}</td>
                  <td>
                    <div className="squad-availability">
                      <span>{player.availability}</span>
                      {player.statuses.map((status) => (
                        <StatusBadge key={status} status={status} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
