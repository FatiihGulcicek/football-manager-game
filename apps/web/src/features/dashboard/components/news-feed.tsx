import type { NewsItem } from '../types';
import { EmptyState, Panel, SectionHeader, StatusBadge } from './primitives';

type NewsFeedProps = {
  items: NewsItem[];
};

export function NewsFeed({ items }: NewsFeedProps) {
  return (
    <Panel ariaLabel="Club news">
      <SectionHeader eyebrow="Inbox pulse" title="Club news" />
      {items.length > 0 ? (
        <ul className="news-feed">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <StatusBadge label={item.category} tone={priorityToTone(item.priority)} />
                <span>{item.timeLabel}</span>
              </div>
              <strong>{item.title}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No club news" description="Messages and reports will appear when there is something new." />
      )}
    </Panel>
  );
}

function priorityToTone(priority: NewsItem['priority']) {
  if (priority === 'high') {
    return 'danger';
  }

  if (priority === 'medium') {
    return 'warning';
  }

  return 'neutral';
}
