import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import type { LeagueStandingRow } from '../types';
import { EmptyState, Panel, SectionHeader } from './primitives';

type LeagueTablePreviewProps = {
  rows: LeagueStandingRow[];
};

export function LeagueTablePreview({ rows }: LeagueTablePreviewProps) {
  return (
    <Panel className="dashboard-table league-panel" ariaLabel="League standings preview">
      <SectionHeader eyebrow="Table" title="League standings" />
      {rows.length > 0 ? (
        <div className="table-scroll">
          <table className="league-table">
            <thead>
              <tr>
                <th scope="col">Pos</th>
                <th scope="col">Club</th>
                <th scope="col">P</th>
                <th scope="col">GD</th>
                <th scope="col">Pts</th>
                <th scope="col">Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.club} className={row.isCurrentClub ? 'is-current-club' : undefined}>
                  <td>{row.position}</td>
                  <th scope="row">{row.club}</th>
                  <td>{row.played}</td>
                  <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                  <td>{row.points}</td>
                  <td>
                    <TrendIcon trend={row.trend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No league table yet" description="Standings will appear once the competition starts." />
      )}
    </Panel>
  );
}

function TrendIcon({ trend }: { trend: LeagueStandingRow['trend'] }) {
  if (trend === 'up') {
    return (
      <span className="trend trend--up">
        <ArrowUp aria-hidden="true" size={15} />
        <span>Up</span>
      </span>
    );
  }

  if (trend === 'down') {
    return (
      <span className="trend trend--down">
        <ArrowDown aria-hidden="true" size={15} />
        <span>Down</span>
      </span>
    );
  }

  return (
    <span className="trend trend--same">
      <ArrowRight aria-hidden="true" size={15} />
      <span>Same</span>
    </span>
  );
}
