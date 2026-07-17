import type { CSSProperties } from 'react';
import { Building2, ShieldCheck, Users } from 'lucide-react';
import type { DashboardClub, DashboardFinancials } from '../types';
import { Panel, ProgressIndicator, StatCard, StatusBadge } from './primitives';

type ClubHeroProps = {
  club: DashboardClub;
  financials: DashboardFinancials;
};

export function ClubHero({ club, financials }: ClubHeroProps) {
  return (
    <section className="club-hero" aria-labelledby="club-hero-title">
      <div className="stadium-visual" aria-hidden="true" />
      <div className="club-hero-content">
        <div className="club-identity">
          <div
            className="club-badge"
            aria-hidden="true"
            style={{
              '--badge-primary': club.primaryColor,
              '--badge-secondary': club.secondaryColor
            } as CSSProperties}
          >
            {club.shortName.slice(0, 3)}
          </div>
          <div>
            <div className="hero-status-row">
              <StatusBadge label={club.status} tone={club.status === 'ACTIVE' ? 'success' : 'warning'} />
              <span>{club.foundedYear ? `Founded ${club.foundedYear}` : 'Founding year pending'}</span>
            </div>
            <h2 id="club-hero-title">{club.name}</h2>
            <p>
              {club.stadiumName} · {club.stadiumCapacityLabel} capacity
            </p>
          </div>
        </div>

        <div className="hero-metrics" aria-label="Club profile">
          <div>
            <ShieldCheck aria-hidden="true" size={18} />
            <span>Reputation</span>
            <strong>{club.reputation}/10000</strong>
          </div>
          <div>
            <Users aria-hidden="true" size={18} />
            <span>Supporters</span>
            <strong>{club.fanCountLabel}</strong>
          </div>
          <div>
            <Building2 aria-hidden="true" size={18} />
            <span>Happiness</span>
            <strong>{club.supporterHappiness}%</strong>
          </div>
        </div>
      </div>

      <Panel className="hero-finance" ariaLabel="Club financial summary">
        <StatCard label="Balance" value={financials.balance} detail={financials.currencyCode} tone="success" />
        <StatCard label="Transfer budget" value={financials.transferBudget} detail="Available" />
        <StatCard label="Wage budget" value={financials.wageBudget} detail="Weekly plan" tone="warning" />
        <ProgressIndicator label="Supporter happiness" value={club.supporterHappiness} tone="success" />
      </Panel>
    </section>
  );
}
