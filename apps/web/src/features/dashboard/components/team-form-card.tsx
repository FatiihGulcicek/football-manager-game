import type { TeamFormResult } from '../types';
import { Panel, SectionHeader } from './primitives';

type TeamFormCardProps = {
  results: TeamFormResult[];
};

export function TeamFormCard({ results }: TeamFormCardProps) {
  const wins = results.filter((result) => result === 'W').length;

  return (
    <Panel ariaLabel="Team form">
      <SectionHeader eyebrow="Last five" title="Team form" />
      <div className="team-form-card">
        <TeamFormStrip results={results} label="Northbridge FC form" />
        <div className="form-summary">
          <strong>{wins}/5</strong>
          <span>Recent wins</span>
        </div>
      </div>
    </Panel>
  );
}

type TeamFormStripProps = {
  results: TeamFormResult[];
  label: string;
};

export function TeamFormStrip({ results, label }: TeamFormStripProps) {
  return (
    <div className="form-strip" aria-label={label}>
      {results.map((result, index) => (
        <span key={`${result}-${index}`} className={`form-pill form-pill--${result.toLowerCase()}`}>
          <span className="sr-only">Match {index + 1}: </span>
          {result}
        </span>
      ))}
    </div>
  );
}
