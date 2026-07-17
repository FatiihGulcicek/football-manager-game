import type { BoardExpectation } from '../types';
import { EmptyState, Panel, ProgressIndicator, SectionHeader, StatusBadge } from './primitives';

type BoardExpectationsProps = {
  expectations: BoardExpectation[];
};

export function BoardExpectations({ expectations }: BoardExpectationsProps) {
  return (
    <Panel className="dashboard-board" ariaLabel="Board expectations">
      <SectionHeader eyebrow="Board" title="Expectations" />
      {expectations.length > 0 ? (
        <div className="expectation-list">
          {expectations.map((expectation) => (
            <article key={expectation.id} className="expectation-item">
              <div>
                <h3>{expectation.label}</h3>
                <StatusBadge label={expectation.current} tone={expectation.tone} />
              </div>
              <ProgressIndicator label="Progress" value={expectation.progress} tone={expectation.tone} />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No board expectations" description="Season objectives will appear after the board briefing." />
      )}
    </Panel>
  );
}
