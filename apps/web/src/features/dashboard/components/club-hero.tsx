import type { CSSProperties } from 'react';
import { BadgeDollarSign, Building2, Landmark, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import type { DashboardClub, DashboardFinancials } from '../types';
import { Panel, ProgressIndicator, StatusBadge } from './primitives';

type ClubHeroProps = {
  club: DashboardClub;
  financials: DashboardFinancials;
};

export function ClubHero({ club, financials }: ClubHeroProps) {
  return (
    <section
      className="club-hero"
      aria-labelledby="club-hero-title"
      style={
        {
          '--badge-primary': club.primaryColor,
          '--badge-secondary': club.secondaryColor,
          '--club-primary': club.primaryColor,
          '--club-secondary': club.secondaryColor
        } as CSSProperties
      }
    >
      <div className="stadium-visual" aria-hidden="true">
        <span className="pitch-line pitch-line--halfway" />
        <span className="pitch-line pitch-line--box-left" />
        <span className="pitch-line pitch-line--box-right" />
      </div>

      <div className="club-hero-content">
        <div className="club-identity">
          <div className="club-badge" aria-hidden="true">
            <span>{club.shortName.slice(0, 3)}</span>
          </div>
          <div className="club-title-block">
            <div className="hero-status-row">
              <StatusBadge label={club.status} tone={club.status === 'ACTIVE' ? 'success' : 'warning'} />
              <span>{club.foundedYear ? `Founded ${club.foundedYear}` : 'Founding year pending'}</span>
            </div>
            <h2 id="club-hero-title">{club.name}</h2>
            <p>
              <Landmark aria-hidden="true" size={16} />
              <span>
                {club.stadiumName} / {club.stadiumCapacityLabel} capacity
              </span>
            </p>
          </div>
        </div>

        <div className="hero-metrics" aria-label="Club profile">
          <div className="hero-metric-card">
            <ShieldCheck aria-hidden="true" size={18} />
            <span>Reputation</span>
            <strong>{club.reputation}/10000</strong>
          </div>
          <div className="hero-metric-card">
            <Users aria-hidden="true" size={18} />
            <span>Supporters</span>
            <strong>{club.fanCountLabel}</strong>
          </div>
          <div className="hero-metric-card">
            <Building2 aria-hidden="true" size={18} />
            <span>Happiness</span>
            <strong>{club.supporterHappiness}%</strong>
          </div>
        </div>
      </div>

      <Panel className="hero-finance" ariaLabel="Club financial summary">
        <div className="finance-header">
          <div>
            <span className="section-eyebrow">Finance room</span>
            <h3>Budget control</h3>
          </div>
          <BadgeDollarSign aria-hidden="true" size={22} />
        </div>
        <div className="finance-grid">
          <div className="finance-card finance-card--primary">
            <span>Balance</span>
            <strong>{financials.balance}</strong>
            <small>{financials.currencyCode}</small>
          </div>
          <div className="finance-card">
            <span>Transfer</span>
            <strong>{financials.transferBudget}</strong>
            <small>Available</small>
          </div>
          <div className="finance-card">
            <span>Wage plan</span>
            <strong>{financials.wageBudget}</strong>
            <small>Weekly</small>
          </div>
          <div className="finance-card finance-card--accent">
            <span>Projection</span>
            <strong>{financials.weeklyProjection}</strong>
            <small>Weekly delta</small>
          </div>
        </div>
        <div className="finance-supporters">
          <TrendingUp aria-hidden="true" size={17} />
          <ProgressIndicator label="Supporter happiness" value={club.supporterHappiness} tone="success" />
        </div>
      </Panel>
    </section>
  );
}
