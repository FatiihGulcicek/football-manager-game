import {
  BadgeDollarSign,
  Building2,
  CalendarDays,
  ClipboardList,
  Dumbbell,
  Flag,
  Gauge,
  GraduationCap,
  Inbox,
  Landmark,
  LineChart,
  Search,
  Settings,
  Shield,
  Trophy,
  Users,
  UserSearch
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
};

export const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: Gauge, enabled: true },
  { label: 'Squad', href: '/squad', icon: Users, enabled: false },
  { label: 'Tactics', href: '/tactics', icon: ClipboardList, enabled: false },
  { label: 'Transfers', href: '/transfers', icon: LineChart, enabled: false },
  { label: 'Match Centre', href: '/match-centre', icon: Trophy, enabled: false },
  { label: 'League / Cups', href: '/league', icon: Flag, enabled: false },
  { label: 'Finance', href: '/finance', icon: BadgeDollarSign, enabled: false },
  { label: 'Facilities', href: '/facilities', icon: Building2, enabled: false },
  { label: 'Youth Academy', href: '/youth-academy', icon: GraduationCap, enabled: false },
  { label: 'Scouting', href: '/scouting', icon: UserSearch, enabled: false },
  { label: 'Staff', href: '/staff', icon: Shield, enabled: false },
  { label: 'Inbox', href: '/inbox', icon: Inbox, enabled: false },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays, enabled: false },
  { label: 'Club', href: '/club', icon: Landmark, enabled: false },
  { label: 'Board', href: '/board', icon: Dumbbell, enabled: false },
  { label: 'Settings', href: '/settings', icon: Settings, enabled: false }
];

export const mobileNavigationItems = [
  navigationItems[0],
  navigationItems[1],
  navigationItems[2],
  navigationItems[12],
  { label: 'Search', href: '/dashboard', icon: Search, enabled: false }
];
