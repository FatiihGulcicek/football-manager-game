import { ArrowUpRight } from 'lucide-react';
import type { SquadPlayer } from '../types';
import { ConditionMeter } from './condition-meter';
import { MoraleIndicator } from './morale-indicator';

type PlayerPreviewProps = {
  player: SquadPlayer | null;
};

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function PlayerPreview({ player }: PlayerPreviewProps) {
  if (!player) {
    return (
      <section className="game-panel squad-player-preview" aria-label="Selected player preview">
        <div className="squad-empty-state" role="status">
          <strong>No player selected</strong>
          <p>Select a squad player to inspect the profile preview.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="game-panel squad-player-preview" aria-label={`${player.name} preview`}>
      <div className="squad-preview-header">
        <span className="squad-preview-portrait" aria-hidden="true">
          {getInitials(player.name)}
        </span>
        <div>
          <p className="section-eyebrow">Player Preview</p>
          <h2>{player.name}</h2>
          <span>
            {player.age} / {player.position}
          </span>
        </div>
      </div>

      <div className="squad-preview-rating-grid">
        <span>
          Rating <strong>{player.rating}</strong>
        </span>
        <span>
          Potential <strong>{player.potential}</strong>
        </span>
      </div>

      <ConditionMeter value={player.condition} label={`${player.name} condition`} />
      <MoraleIndicator morale={player.morale} />

      <dl className="squad-preview-details">
        <div>
          <dt>Market Value</dt>
          <dd>{player.marketValue}</dd>
        </div>
        <div>
          <dt>Weekly Wage</dt>
          <dd>{player.weeklyWage}</dd>
        </div>
        <div>
          <dt>Contract</dt>
          <dd>{player.contract}</dd>
        </div>
      </dl>

      <button className="primary-button squad-preview-action" type="button">
        Open Player Profile
        <ArrowUpRight aria-hidden="true" size={17} />
      </button>
    </section>
  );
}
