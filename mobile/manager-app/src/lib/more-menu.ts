export type MenuItem = {
  route: string;
  label: string;
  hint?: string;
  /** A single character, not an icon component — these apps ship no vector library. */
  glyph: string;
  /** Searchable terms beyond the label, so "rota" finds Calendar. */
  keywords?: string[];
};

export type MenuGroup = { key: string; title: string; items: MenuItem[] };

type Translate = (key: string) => string;

/**
 * The More menu, grouped by what a manager is trying to DO.
 *
 * Grouped by task, not by backend module. "Payslips" sits with People
 * because a manager fulfilling one is thinking about a person, not about the
 * HR service — and a menu organised by the server's module boundaries is a
 * menu organised for the people who built it.
 *
 * Order within the file is the order on screen, and the groups are ordered by
 * expected frequency: the work of the day first, the org behind it second,
 * personal settings last. That mirrors the advice that grouped menus should
 * put the most-used category at the top rather than sorting alphabetically.
 *
 * ATTENDANCE IS ABSENT (2026-09-23, project owner's decision): hidden for
 * manager, regional manager and admin alike. The ROUTES still exist and are
 * still reachable — the WORKER_NO_SHOW push deep-links to
 * `/attendance/:id`, and deleting the screens would create a dead link of
 * exactly the kind this app has already shipped three times.
 */
export function buildMenu(context: {
  t: Translate;
  role: string | null | undefined;
  scopeKind: string;
}): MenuGroup[] {
  const { t, role, scopeKind } = context;
  // An admin is distinguished by GLOBAL SCOPE as well as the role string: an
  // admin and a regional manager both have a null scope_hotel_id, and the
  // role alone has put an RM in the admin branch before.
  const isAdmin = role === 'admin' && scopeKind === 'global';
  const canSeeOrgChart = scopeKind === 'group' || scopeKind === 'global';

  const groups: MenuGroup[] = [
    {
      key: 'work',
      title: t('nav.assignments'),
      items: [
        {
          route: '/assignments',
          label: t('nav.assignments'),
          glyph: '▤',
          keywords: ['shift', 'shifts', 'work'],
        },
        {
          route: '/requests',
          label: t('nav.requests'),
          glyph: '✚',
          keywords: ['job', 'broadcast', 'vacancy', 'open'],
        },
        {
          route: '/review-queue',
          label: t('nav.reviewQueue'),
          glyph: '◷',
          keywords: ['approve', 'application', 'onboarding'],
        },
      ],
    },
    {
      key: 'people',
      title: t('nav.users'),
      items: [
        { route: '/(app)/team', label: t('nav.users'), glyph: '◍', keywords: ['staff', 'worker', 'employee'] },
        {
          route: '/payslips',
          label: t('hr.payslipRequests'),
          glyph: '€',
          keywords: ['pay', 'payroll', 'salary', 'hr'],
        },
        { route: '/documents', label: t('nav.docs'), glyph: '▣', keywords: ['file', 'upload', 'contract'] },
      ],
    },
    {
      key: 'org',
      title: t('nav.hotels'),
      items: [
        { route: '/hotels', label: t('nav.hotels'), glyph: '⌂', keywords: ['property', 'group', 'site'] },
        ...(canSeeOrgChart
          ? [
              {
                route: '/hotels',
                label: t('hotels.orgChart'),
                glyph: '⑃',
                keywords: ['structure', 'hierarchy', 'reporting'],
              },
            ]
          : []),
      ],
    },
    {
      key: 'insight',
      title: t('nav.analytics'),
      items: [
        { route: '/analytics', label: t('nav.analytics'), glyph: '◲', keywords: ['stats', 'report', 'kpi'] },
        {
          route: '/leaderboard',
          label: t('nav.leaderboard'),
          glyph: '★',
          keywords: ['ranking', 'top', 'quality', 'rating'],
        },
      ],
    },
    {
      key: 'account',
      title: t('nav.account'),
      items: [
        { route: '/notifications', label: t('nav.notifications'), glyph: '◔', keywords: ['alert'] },
        { route: '/assistant', label: t('chatbot.title'), glyph: '✳', keywords: ['zelle', 'ai', 'ask', 'help'] },
        {
          route: '/settings',
          label: t('nav.settings'),
          glyph: '⚙',
          keywords: ['language', 'theme', 'export', 'logout'],
        },
        { route: '/onboarding', label: t('nav.myOnboarding'), glyph: '◌', keywords: ['my documents'] },
      ],
    },
  ];

  if (isAdmin) {
    groups.push({
      key: 'admin',
      title: t('nav.archive'),
      items: [
        {
          route: '/admin/archive',
          label: t('nav.archive'),
          glyph: '⎌',
          keywords: ['deleted', 'restore', 'archived'],
        },
      ],
    });
  }

  return groups;
}

/**
 * Narrows the menu to what matches, keeping group structure.
 *
 * Matches the label AND the keywords, so "rota" finds Calendar and "salary"
 * finds Payslips — a manager should not have to guess the product's own word
 * for a thing. Empty groups drop out rather than rendering a header with
 * nothing under it.
 */
export function filterMenu(groups: readonly MenuGroup[], query: string): MenuGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = [item.label, item.hint ?? '', ...(item.keywords ?? [])]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
