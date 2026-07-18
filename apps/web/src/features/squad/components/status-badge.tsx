import { AlertTriangle, Ban, CircleSlash, Clock3, Plane, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlayerStatusType } from '../types';

const statusMeta: Record<PlayerStatusType, { label: string; className: string; icon: LucideIcon }> = {
  injured: { label: 'Injured', className: 'injured', icon: AlertTriangle },
  suspended: { label: 'Suspended', className: 'suspended', icon: Ban },
  loan: { label: 'Loan', className: 'loan', icon: Plane },
  'transfer-listed': { label: 'Transfer Listed', className: 'transfer-listed', icon: Tag },
  'contract-expiring': { label: 'Contract Expiring', className: 'contract-expiring', icon: Clock3 },
  unavailable: { label: 'Unavailable', className: 'unavailable', icon: CircleSlash }
};

export function StatusBadge({ status }: { status: PlayerStatusType }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;

  return (
    <span
      className={`squad-status-badge squad-status-badge--${meta.className}`}
      aria-label={`Player status: ${meta.label}`}
    >
      <Icon aria-hidden="true" size={13} />
      {meta.label}
    </span>
  );
}
