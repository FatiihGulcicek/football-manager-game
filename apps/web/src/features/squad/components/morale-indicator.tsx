import { AlertCircle, Frown, Meh, Smile } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlayerMorale } from '../types';

const moraleMeta: Record<PlayerMorale, { className: string; icon: LucideIcon }> = {
  Excellent: { className: 'excellent', icon: Smile },
  Good: { className: 'good', icon: Smile },
  Concerned: { className: 'concerned', icon: Meh },
  Poor: { className: 'poor', icon: Frown }
};

export function MoraleIndicator({ morale }: { morale: PlayerMorale }) {
  const meta = moraleMeta[morale] ?? { className: 'concerned', icon: AlertCircle };
  const Icon = meta.icon;

  return (
    <span className={`squad-morale squad-morale--${meta.className}`} aria-label={`Morale: ${morale}`}>
      <Icon aria-hidden="true" size={15} />
      {morale}
    </span>
  );
}
