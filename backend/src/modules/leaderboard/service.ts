import { BaseService } from '../../lib/base-service.js';
import { LeaderboardEntryDto, LeaderboardQuery } from './types.js';

export class LeaderboardService extends BaseService {
  // Global leaderboard — reads the materialised WorkerOverallRating aggregate
  // (maintained by the Rating DB trigger). Ranked by average_score.
  async global(query: LeaderboardQuery): Promise<{ data: LeaderboardEntryDto[]; total: number }> {
    const [records, total] = await Promise.all([
      this.prisma.workerOverallRating.findMany({
        where: { total_ratings: { gt: 0 } },
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: [{ average_score: 'desc' }, { total_ratings: 'desc' }],
      }),
      this.prisma.workerOverallRating.count({ where: { total_ratings: { gt: 0 } } }),
    ]);

    const offset = (query.page - 1) * query.per_page;
    const data: LeaderboardEntryDto[] = records.map((r, i) => ({
      rank: offset + i + 1,
      worker_id: r.worker_id,
      average_score: r.average_score,
      total_ratings: r.total_ratings,
      last_worked_at: r.last_worked_at?.toISOString() ?? null,
    }));

    return { data, total };
  }

  // Hotel-scoped leaderboard — WorkerOverallRating is global, so per-hotel
  // standings are aggregated on the fly from Rating rows for that hotel.
  async byHotel(
    hotelId: string,
    query: LeaderboardQuery
  ): Promise<{ data: LeaderboardEntryDto[]; total: number }> {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) return { data: [], total: 0 };

    const grouped = await this.prisma.rating.groupBy({
      by: ['worker_id'],
      where: { hotel_id: hotelId },
      _avg: { score: true },
      _count: { _all: true },
      _max: { created_at: true },
      orderBy: { _avg: { score: 'desc' } },
    });

    const total = grouped.length;
    const offset = (query.page - 1) * query.per_page;
    const page = grouped.slice(offset, offset + query.per_page);

    const data: LeaderboardEntryDto[] = page.map((g, i) => ({
      rank: offset + i + 1,
      worker_id: g.worker_id,
      average_score: g._avg.score ?? 0,
      total_ratings: g._count._all,
      last_worked_at: g._max.created_at?.toISOString() ?? null,
    }));

    return { data, total };
  }
}

export const leaderboardService = new LeaderboardService();
