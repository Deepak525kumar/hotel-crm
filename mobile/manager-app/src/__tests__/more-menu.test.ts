import { buildMenu, filterMenu } from '@/lib/more-menu';

const t = (key: string) => key;

describe('the More menu', () => {
  const managerMenu = buildMenu({ t, role: 'manager', scopeKind: 'hotel' });
  const rmMenu = buildMenu({ t, role: 'regional_manager', scopeKind: 'group' });
  const adminMenu = buildMenu({ t, role: 'admin', scopeKind: 'global' });

  it('is grouped, not one flat list', () => {
    expect(managerMenu.length).toBeGreaterThan(3);
    expect(managerMenu.every((g) => g.items.length > 0)).toBe(true);
  });

  // The whole point of the archive entry existing only for an admin: a row
  // that opens a 403 teaches the manager the app is unreliable.
  it('shows Archive to an admin and to nobody else', () => {
    const hasArchive = (menu: ReturnType<typeof buildMenu>) =>
      menu.some((g) => g.items.some((i) => i.route === '/admin/archive'));
    expect(hasArchive(adminMenu)).toBe(true);
    expect(hasArchive(managerMenu)).toBe(false);
    expect(hasArchive(rmMenu)).toBe(false);
  });

  /**
   * An admin is identified by GLOBAL SCOPE as well as the role string.
   *
   * An admin and a regional manager both have a null `scope_hotel_id`, and
   * branching on the role alone has already put an RM in the admin branch in
   * this codebase.
   */
  it('does not treat a role of admin without global scope as an admin', () => {
    const odd = buildMenu({ t, role: 'admin', scopeKind: 'hotel' });
    expect(odd.some((g) => g.items.some((i) => i.route === '/admin/archive'))).toBe(false);
  });

  // org_chart:read is the ONE token an RM holds that a manager does not.
  it('offers the org chart to an RM and an admin, not to a hotel manager', () => {
    const hasOrgChart = (menu: ReturnType<typeof buildMenu>) =>
      menu.some((g) => g.items.some((i) => i.label === 'hotels.orgChart'));
    expect(hasOrgChart(rmMenu)).toBe(true);
    expect(hasOrgChart(adminMenu)).toBe(true);
    expect(hasOrgChart(managerMenu)).toBe(false);
  });

  // Attendance is hidden for all three roles (2026-09-23 decision), but its
  // ROUTES remain for the WORKER_NO_SHOW deep link.
  it('does not list attendance for anyone', () => {
    for (const menu of [managerMenu, rmMenu, adminMenu]) {
      expect(menu.some((g) => g.items.some((i) => i.route.includes('attendance')))).toBe(false);
    }
  });
});

describe('menu search', () => {
  const menu = buildMenu({ t, role: 'admin', scopeKind: 'global' });

  it('returns everything for an empty query', () => {
    expect(filterMenu(menu, '')).toHaveLength(menu.length);
    expect(filterMenu(menu, '   ')).toHaveLength(menu.length);
  });

  /**
   * Keywords, not just labels.
   *
   * A manager should not have to guess the product's own word for a thing:
   * "salary" has to find Payslips and "rota" has to find the schedule, or the
   * search is only useful to people who already know where everything is.
   */
  it('matches on keywords as well as labels', () => {
    const bySalary = filterMenu(menu, 'salary');
    expect(bySalary.flatMap((g) => g.items).some((i) => i.route === '/payslips')).toBe(true);

    const byRanking = filterMenu(menu, 'ranking');
    expect(byRanking.flatMap((g) => g.items).some((i) => i.route === '/leaderboard')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(filterMenu(menu, 'SALARY').flatMap((g) => g.items).length).toBeGreaterThan(0);
  });

  // A header with nothing under it reads as a loading bug.
  it('drops groups that have no matches rather than showing an empty header', () => {
    const results = filterMenu(menu, 'salary');
    expect(results.every((g) => g.items.length > 0)).toBe(true);
  });

  it('returns nothing for a term that matches nothing', () => {
    expect(filterMenu(menu, 'zzzzz')).toEqual([]);
  });
});
