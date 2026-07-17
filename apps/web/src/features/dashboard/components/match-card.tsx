import { MapPin, Timer } from 'lucide-react';
import type { UpcomingMatch } from '../types';
import { EmptyState, Panel, SectionHeader, StatusBadge } from './primitives';
import { TeamFormStrip } from './team-form-card';

type MatchCardProps = {
  match: UpcomingMatch | null;
};

export function MatchCard({ match }: MatchCardProps) {
  return (
    <Panel ariaLabel="Upcoming match">
      <SectionHeader eyebrow="Next fixture" title="Upcoming match" />
      {match ? (
        <div className="match-card">
          <div>
            <StatusBadge label={match.competition} tone="accent" />
            <h3>{match.opponent}</h3>
          </div>
          <div className="match-meta">
            <span>
              <Timer aria-hidden="true" size={16} />
              {match.kickoffLabel}
            </span>
            <span>
              <MapPin aria-hidden="true" size={16} />
              {match.venue}
            </span>
          </div>
          <p>{match.tacticalFocus}</p>
          <TeamFormStrip results={match.opponentForm} label="Opponent form" />
        </div>
      ) : (
        <EmptyState title="No fixture scheduled" description="The next official match will appear here." />
      )}
    </Panel>
  );
}
