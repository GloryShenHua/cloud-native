import type { ReactNode, SVGProps } from 'react';

type IconName = 'building' | 'calendar' | 'list' | 'plus' | 'refresh' | 'search' | 'arrow-right';

const paths: Record<IconName, ReactNode> = {
  building: <><path d="M4 21V5h11v16M15 11h5v10M2 21h20" /><path d="M8 9h3M8 13h3M8 17h3M17 15h1M17 18h1" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h2M7 18h2" /></>,
  list: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9M3 4v5h5M4 13a8 8 0 0 0 14 5l3-3M21 20v-5h-5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  'arrow-right': <path d="M5 12h14m-5-5 5 5-5 5" />,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    {paths[name]}
  </svg>;
}
