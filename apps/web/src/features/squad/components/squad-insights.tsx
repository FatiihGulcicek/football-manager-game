import { AlertTriangle, CheckCircle2, CircleDot, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SquadInsight, SquadInsightTone } from '../types';

const insightIcons: Record<SquadInsightTone, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
  neutral: Info
};

export function SquadInsights({ insights }: { insights: SquadInsight[] }) {
  if (insights.length === 0) {
    return (
      <section className="game-panel squad-insights" aria-label="Squad insights">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Signals</p>
            <h2>Squad Insights</h2>
          </div>
        </div>
        <div className="squad-empty-state" role="status">
          <strong>No squad insights</strong>
          <p>Actionable squad signals will appear after analysis.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="game-panel squad-insights" aria-label="Squad insights">
      <div className="section-header">
        <div>
          <p className="section-eyebrow">Signals</p>
          <h2>Squad Insights</h2>
        </div>
      </div>
      <ul className="squad-insight-list">
        {insights.map((insight) => {
          const Icon = insightIcons[insight.tone] ?? CircleDot;

          return (
            <li key={insight.id} className={`squad-insight squad-insight--${insight.tone}`}>
              <Icon aria-hidden="true" size={18} />
              <div>
                <strong>{insight.label}</strong>
                <p>{insight.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
