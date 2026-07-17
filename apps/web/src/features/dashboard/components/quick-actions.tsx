import Link from 'next/link';
import type { QuickAction } from '../types';
import { EmptyState, Panel, SectionHeader } from './primitives';

type QuickActionsProps = {
  actions: QuickAction[];
};

export function QuickActions({ actions }: QuickActionsProps) {
  return (
    <Panel className="dashboard-actions" ariaLabel="Quick access actions">
      <SectionHeader eyebrow="Operations" title="Quick actions" />
      {actions.length > 0 ? (
        <div className="quick-actions">
          {actions.map((action) => {
            const Icon = action.icon;

            if (action.disabled || !action.href) {
              return (
                <button key={action.id} className="quick-action" type="button" disabled>
                  <Icon aria-hidden="true" size={20} />
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                </button>
              );
            }

            return (
              <Link key={action.id} className="quick-action" href={action.href}>
                <Icon aria-hidden="true" size={20} />
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No quick actions" description="Contextual actions will appear when management areas unlock." />
      )}
    </Panel>
  );
}
