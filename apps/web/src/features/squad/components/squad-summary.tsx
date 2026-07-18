import { BadgeDollarSign, CircleSlash, Globe2, HeartPulse, LineChart, ShieldCheck, Timer, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SquadSummary as SquadSummaryModel } from '../types';

type SummaryItem = {
  label: string;
  value: string;
  icon: LucideIcon;
};

export function SquadSummary({ summary }: { summary: SquadSummaryModel }) {
  const items: SummaryItem[] = [
    { label: 'Total Players', value: String(summary.totalPlayers), icon: Users },
    { label: 'Average Age', value: summary.averageAge, icon: Timer },
    { label: 'Weekly Wage', value: summary.weeklyWage, icon: BadgeDollarSign },
    { label: 'Squad Value', value: summary.squadValue, icon: LineChart },
    { label: 'Homegrown', value: String(summary.homegrown), icon: ShieldCheck },
    { label: 'Foreign Players', value: String(summary.foreignPlayers), icon: Globe2 },
    { label: 'Injured', value: String(summary.injured), icon: HeartPulse },
    { label: 'Unavailable', value: String(summary.unavailable), icon: CircleSlash }
  ];

  return (
    <section className="squad-summary-strip" aria-label="Squad summary">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <div key={item.label} className="squad-summary-item">
            <Icon aria-hidden="true" size={17} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        );
      })}
    </section>
  );
}
