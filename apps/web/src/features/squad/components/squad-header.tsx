import { CalendarDays, Shield, Trophy } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { SquadViewModel } from '../types';

type SquadHeaderProps = {
  club: SquadViewModel['club'];
};

type BadgeStyle = CSSProperties & {
  '--badge-primary': string;
  '--badge-secondary': string;
};

export function SquadHeader({ club }: SquadHeaderProps) {
  const badgeStyle: BadgeStyle = {
    '--badge-primary': club.primaryColor,
    '--badge-secondary': club.secondaryColor
  };

  return (
    <header className="squad-header">
      <div className="squad-header__identity">
        <span className="squad-club-badge" style={badgeStyle} aria-hidden="true">
          {club.shortName}
        </span>
        <div>
          <p className="section-eyebrow">First Team</p>
          <h1>Squad</h1>
          <div className="squad-header__meta" aria-label="Club context">
            <span>
              <Shield aria-hidden="true" size={16} />
              {club.name}
            </span>
            <span>
              <CalendarDays aria-hidden="true" size={16} />
              {club.season}
            </span>
            <span>
              <Trophy aria-hidden="true" size={16} />
              {club.competition}
            </span>
          </div>
        </div>
      </div>
      <span className="squad-window-badge">{club.transferWindowState}</span>
    </header>
  );
}
