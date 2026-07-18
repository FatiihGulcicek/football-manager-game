import { AlertTriangle } from 'lucide-react';
import type { PositionDepthGroup } from '../types';

export function PositionDepthPanel({ groups }: { groups: PositionDepthGroup[] }) {
  if (groups.length === 0) {
    return (
      <section className="game-panel squad-depth-panel" aria-label="Tactical position depth">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Tactics</p>
            <h2>Tactical Position Depth</h2>
          </div>
        </div>
        <div className="squad-empty-state" role="status">
          <strong>No tactical depth data</strong>
          <p>Depth will appear once squad positions are available.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="game-panel squad-depth-panel" aria-label="Tactical position depth">
      <div className="section-header">
        <div>
          <p className="section-eyebrow">Tactics</p>
          <h2>Tactical Position Depth</h2>
        </div>
      </div>

      <div className="position-depth-pitch" role="img" aria-label="Football pitch with squad depth by position">
        {groups.map((group) => (
          <div key={group.id} className={`position-depth-group ${group.zoneClass}`}>
            <span className="position-depth-label">{group.label}</span>
            <strong>{group.starter}</strong>
            <span className="position-depth-role">Starter</span>
            {group.backups.length > 0 ? (
              <span className="position-depth-backups">Backup: {group.backups.join(', ')}</span>
            ) : (
              <span className="position-depth-backups">Backup needed</span>
            )}
            {group.isWeak ? (
              <span className="position-depth-warning">
                <AlertTriangle aria-hidden="true" size={13} />
                Weak depth
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
