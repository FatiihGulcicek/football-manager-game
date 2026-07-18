import { Crown, ShieldCheck } from 'lucide-react';
import type { SquadPlayer } from '../types';
import { ConditionMeter } from './condition-meter';
import { MoraleIndicator } from './morale-indicator';
import { StatusBadge } from './status-badge';

type PlayerCardProps = {
  player: SquadPlayer;
  isSelected: boolean;
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

export function PlayerCard({ player, isSelected, onSelectPlayer }: PlayerCardProps) {
  return (
    <article className={`squad-player-card ${isSelected ? 'is-selected' : ''}`.trim()}>
      <button
        className="squad-player-card__select"
        type="button"
        aria-label={`Select ${player.name}`}
        aria-pressed={isSelected}
        onClick={() => onSelectPlayer(player.id)}
      >
        <span className="squad-player-avatar squad-player-avatar--large" aria-hidden="true">
          {getInitials(player.name)}
        </span>
        <span className="squad-player-card__identity">
          <strong>{player.name}</strong>
          <small>
            #{player.shirtNumber} / {player.position} / {player.age}
          </small>
        </span>
        <span className="squad-player-card__leadership">
          {player.isCaptain ? <Crown aria-label="Captain" size={15} /> : null}
          {player.isViceCaptain ? <ShieldCheck aria-label="Vice captain" size={15} /> : null}
        </span>
      </button>

      <div className="squad-player-card__metrics">
        <span>
          Rating <strong>{player.rating}</strong>
        </span>
        <span>
          Potential <strong>{player.potential}</strong>
        </span>
        <span>
          Value <strong>{player.marketValue}</strong>
        </span>
      </div>

      <ConditionMeter value={player.condition} label={`${player.name} condition`} />
      <div className="squad-player-card__footer">
        <MoraleIndicator morale={player.morale} />
        <span>{player.availability}</span>
      </div>
      {player.statuses.length > 0 ? (
        <div className="squad-status-list">
          {player.statuses.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
