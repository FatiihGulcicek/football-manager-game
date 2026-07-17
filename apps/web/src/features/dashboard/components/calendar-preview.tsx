import { CalendarClock } from 'lucide-react';
import type { CalendarItem } from '../types';
import { EmptyState, Panel, SectionHeader, StatusBadge } from './primitives';

type CalendarPreviewProps = {
  items: CalendarItem[];
};

export function CalendarPreview({ items }: CalendarPreviewProps) {
  return (
    <Panel className="dashboard-calendar" ariaLabel="Calendar preview">
      <SectionHeader eyebrow="Schedule" title="Calendar" />
      {items.length > 0 ? (
        <ol className="calendar-list">
          {items.map((item) => (
            <li key={item.id}>
              <time>{item.dateLabel}</time>
              <div>
                <h3>{item.title}</h3>
                <span>
                  <CalendarClock aria-hidden="true" size={15} />
                  {item.meta}
                </span>
              </div>
              <StatusBadge label={item.type} tone={item.type === 'match' ? 'accent' : 'neutral'} />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="No calendar items" description="Fixtures and club events will appear here." />
      )}
    </Panel>
  );
}
