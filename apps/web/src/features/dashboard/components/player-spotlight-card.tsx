import type { PlayerSpotlight } from '../types';
import { Panel, ProgressIndicator, SectionHeader } from './primitives';
import { TeamFormStrip } from './team-form-card';

type PlayerSpotlightCardProps = {
  players: PlayerSpotlight[];
};

export function PlayerSpotlightCard({ players }: PlayerSpotlightCardProps) {
  return (
    <Panel className="player-panel" ariaLabel="Featured players">
      <SectionHeader eyebrow="Squad pulse" title="Featured players" />
      <div className="player-grid">
        {players.map((player) => (
          <article key={player.id} className="player-card">
            <div className="player-avatar" aria-hidden="true">
              {player.name
                .split(' ')
                .map((part) => part[0])
                .join('')
                .slice(0, 2)}
            </div>
            <div className="player-main">
              <div>
                <h3>{player.name}</h3>
                <span>
                  {player.position} · Age {player.age}
                </span>
              </div>
              <strong>{player.rating}</strong>
            </div>
            <p>{player.note}</p>
            <ProgressIndicator label="Condition" value={player.condition} tone={player.condition > 85 ? 'success' : 'warning'} />
            <TeamFormStrip results={player.form} label={`${player.name} form`} />
          </article>
        ))}
      </div>
    </Panel>
  );
}
