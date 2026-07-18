import Link from 'next/link';
import { mobileNavigationItems } from '../navigation';

type MobileNavigationProps = {
  activePath: string;
};

export function MobileNavigation({ activePath }: MobileNavigationProps) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {mobileNavigationItems.map((item) => {
        const Icon = item.icon;
        const isActive = activePath === item.href && item.enabled;

        if (!item.enabled) {
          return (
            <button key={item.id} className="mobile-nav-item mobile-nav-item--disabled" type="button" disabled>
              <Icon aria-hidden="true" size={20} />
              <span>{item.label}</span>
            </button>
          );
        }

        return (
          <Link
            key={item.id}
            className="mobile-nav-item"
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
