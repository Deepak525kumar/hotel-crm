import {
  AssignmentStatus,
  WorkRequestStatus,
  AttendanceStatus,
  VerificationStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { DashboardStats, HotelSummary, LeaderboardEntry, WorkerStats } from './types.js';

interface OverallRatingRow {
  worker_id: string;
  average_score: number;
  total_assignments: number;
  completion_rate: number;
  worker: { first_name: string; last_name: string };
}

export class AnalyticsService extends BaseService {
  // Single source of truth for both /analytics/leaderboard and
  // /quality/leaderboard: the transactionally-maintained WorkerOverallRating
  // aggregate (written on every rating). This endpoint preserves its existing
  // LeaderboardEntry contract while reading the same rows — and using the same
  // average_score ordering — as /quality/leaderboard, so the two surfaces can
  // never rank a worker differently.
  // `hotelGroupId` (ADR-030 PR-4, D-7) lets a scoped manager/regional_manager's
  // own group filter directly, without resolving through a specific hotel.
  async getLeaderboard(hotelId?: string, hotelGroupId?: string): Promise<LeaderboardEntry[]> {
    let where: Record<string, unknown> = {};
    if (hotelGroupId) {
      where = {
        worker: {
          employment_record: { hotel_group_id: hotelGroupId, status: 'ACTIVE' },
        },
      };
    } else if (hotelId) {
      const hotel = await this.prisma.hotel.findUnique({
        where: { id: hotelId },
        select: { hotel_group_id: true },
      });
      where = {
        worker: {
          employment_record: { hotel_group_id: hotel?.hotel_group_id ?? '__none__', status: 'ACTIVE' },
        },
      };
    }

    const rows = (await this.prisma.workerOverallRating.findMany({
      where,
      include: {
        worker: { select: { first_name: true, last_name: true } },
      },
      orderBy: { average_score: 'desc' },
      take: 50,
    })) as OverallRatingRow[];

    return rows.map((row, idx): LeaderboardEntry => {
      const total = row.total_assignments;
      return {
        worker_id: row.worker_id,
        name: `${row.worker.first_name} ${row.worker.last_name}`,
        total_tasks: total,
        completed_tasks: Math.round(row.completion_rate * total),
        average_rating: Math.round(row.average_score * 100) / 100,
        position: idx + 1,
      };
    });
  }

  // `hotelGroupId` (ADR-030 PR-4, D-7): these models are hotel-grain, so a
  // group filter resolves to `hotel_id IN (every hotel in the group)`.
  async getDashboardStats(hotelId?: string, hotelGroupId?: string): Promise<DashboardStats> {
    let scope: Record<string, unknown> = {};
    if (hotelGroupId) {
      const hotels = await this.prisma.hotel.findMany({
        where: { hotel_group_id: hotelGroupId },
        select: { id: true },
      });
      scope = { hotel_id: { in: hotels.map((h) => h.id) } };
    } else if (hotelId) {
      scope = { hotel_id: hotelId };
    }

    const [
      totalRequests,
      requestsByStatus,
      totalAssignments,
      assignmentsByStatus,
      totalAttendance,
      attendanceByStatus,
      qualityAgg,
      qualityPassed,
      totalQuality,
      ratingAgg,
      totalRatings,
      roomsCompletedAgg,
    ] = await Promise.all([
      this.prisma.jobRequest.count({ where: scope }),
      this.prisma.jobRequest.groupBy({
        by: ['status'],
        where: scope,
        _count: { id: true },
      }),
      this.prisma.workerAssignment.count({ where: scope }),
      this.prisma.workerAssignment.groupBy({
        by: ['status'],
        where: scope,
        _count: { id: true },
      }),
      this.prisma.attendance.count({ where: scope }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: scope,
        _count: { id: true },
      }),
      this.prisma.qualityVerification.aggregate({
        where: scope,
        _avg: { score: true },
      }),
      this.prisma.qualityVerification.count({
        where: { ...scope, status: VerificationStatus.PASSED },
      }),
      this.prisma.qualityVerification.count({ where: scope }),
      this.prisma.rating.aggregate({
        where: scope,
        _avg: { score: true },
      }),
      this.prisma.rating.count({ where: scope }),
      // ADR-028 (OQ-ANALYTICS-03): basic-analytics "rooms completed per worker",
      // derived from the manager-entered RoomsCompletedEntry.
      this.prisma.roomsCompletedEntry.aggregate({
        where: scope,
        _sum: { rooms_completed: true },
        _count: true,
      }),
    ]);

    const reqMap = new Map(
      (requestsByStatus as Array<{ status: WorkRequestStatus; _count: { id: number } }>).map(
        (r) => [r.status, r._count.id]
      )
    );
    const asnMap = new Map(
      (
        assignmentsByStatus as Array<{
          status: AssignmentStatus;
          _count: { id: number };
        }>
      ).map((a) => [a.status, a._count.id])
    );
    const attMap = new Map(
      (
        attendanceByStatus as Array<{ status: AttendanceStatus; _count: { id: number } }>
      ).map((a) => [a.status, a._count.id])
    );

    const onTimeCount = attMap.get(AttendanceStatus.PRESENT) ?? 0;
    const qualityAvg = (qualityAgg as { _avg: { score: number | null } })._avg.score;
    const ratingAvg = (ratingAgg as { _avg: { score: number | null } })._avg.score;

    return {
      work_requests: {
        total: totalRequests as number,
        open: reqMap.get(WorkRequestStatus.OPEN) ?? 0,
        partially_filled: reqMap.get(WorkRequestStatus.PARTIALLY_FILLED) ?? 0,
        filled: reqMap.get(WorkRequestStatus.FILLED) ?? 0,
        cancelled: reqMap.get(WorkRequestStatus.CANCELLED) ?? 0,
        expired: reqMap.get(WorkRequestStatus.EXPIRED) ?? 0,
      },
      assignments: {
        total: totalAssignments as number,
        completed: asnMap.get(AssignmentStatus.COMPLETED) ?? 0,
        in_progress: asnMap.get(AssignmentStatus.IN_PROGRESS) ?? 0,
        no_show: asnMap.get(AssignmentStatus.NO_SHOW) ?? 0,
        cancelled: asnMap.get(AssignmentStatus.CANCELLED) ?? 0,
      },
      attendance: {
        total: totalAttendance as number,
        present:
          (attMap.get(AttendanceStatus.PRESENT) ?? 0) +
          (attMap.get(AttendanceStatus.LATE) ?? 0),
        late: attMap.get(AttendanceStatus.LATE) ?? 0,
        absent: attMap.get(AttendanceStatus.ABSENT) ?? 0,
        on_time_rate:
          (totalAttendance as number) > 0
            ? Math.round((onTimeCount / (totalAttendance as number)) * 10000) / 100
            : 0,
      },
      quality: {
        total_verifications: totalQuality as number,
        average_score: qualityAvg !== null ? Math.round((qualityAvg ?? 0) * 100) / 100 : null,
        pass_rate:
          (totalQuality as number) > 0
            ? Math.round(((qualityPassed as number) / (totalQuality as number)) * 10000) / 100
            : 0,
      },
      ratings: {
        total: totalRatings as number,
        average_score: ratingAvg !== null ? Math.round((ratingAvg ?? 0) * 100) / 100 : null,
      },
      rooms_completed: {
        total:
          (roomsCompletedAgg as { _sum: { rooms_completed: number | null } })._sum
            .rooms_completed ?? 0,
        entries: (roomsCompletedAgg as { _count: number })._count,
      },
    };
  }

  // GD-06: worker-scoped analytics (own stats only), resolving the
  // mobile-worker dashboard's previously-silent 403 against the
  // admin/manager-only /stats route. Server-scoped to workerId — the caller
  // (controller) must pass only req.auth.userId, never a client-supplied id.
  async getWorkerStats(workerId: string): Promise<WorkerStats> {
    const [completedAssignments, roomsCompletedAgg, overallRating, attendanceByStatus, totalAttendance] =
      await Promise.all([
        this.prisma.workerAssignment.count({
          where: { worker_id: workerId, status: AssignmentStatus.COMPLETED },
        }),
        this.prisma.roomsCompletedEntry.aggregate({
          where: { worker_id: workerId },
          _sum: { rooms_completed: true },
        }),
        this.prisma.workerOverallRating.findUnique({
          where: { worker_id: workerId },
          select: { average_score: true },
        }),
        this.prisma.attendance.groupBy({
          by: ['status'],
          where: { worker_id: workerId },
          _count: { id: true },
        }),
        this.prisma.attendance.count({ where: { worker_id: workerId } }),
      ]);

    const attMap = new Map(
      (attendanceByStatus as Array<{ status: AttendanceStatus; _count: { id: number } }>).map(
        (a) => [a.status, a._count.id]
      )
    );

    return {
      completed_assignments: completedAssignments,
      rooms_completed:
        (roomsCompletedAgg as { _sum: { rooms_completed: number | null } })._sum
          .rooms_completed ?? 0,
      average_rating: overallRating?.average_score ?? null,
      attendance: {
        total: totalAttendance,
        present: attMap.get(AttendanceStatus.PRESENT) ?? 0,
        late: attMap.get(AttendanceStatus.LATE) ?? 0,
        absent: attMap.get(AttendanceStatus.ABSENT) ?? 0,
      },
    };
  }

  async getHotelSummary(hotelId: string): Promise<HotelSummary> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      openRequestsAgg,
      activeAssignments,
      todayAttendanceGroups,
      qualityAgg,
      qualityPassed,
      totalQuality,
      roomsCompletedAgg,
      topWorkers,
    ] = await Promise.all([
      this.prisma.jobRequest.aggregate({
        where: {
          hotel_id: hotelId,
          status: { in: [WorkRequestStatus.OPEN, WorkRequestStatus.PARTIALLY_FILLED] },
        },
        _count: { id: true },
        _sum: { workers_needed: true, workers_confirmed: true },
      }),
      this.prisma.workerAssignment.count({
        where: { hotel_id: hotelId, status: AssignmentStatus.IN_PROGRESS },
      }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: {
          hotel_id: hotelId,
          created_at: { gte: today, lt: tomorrow },
        },
        _count: { id: true },
      }),
      this.prisma.qualityVerification.aggregate({
        where: { hotel_id: hotelId },
        _avg: { score: true },
      }),
      this.prisma.qualityVerification.count({
        where: { hotel_id: hotelId, status: VerificationStatus.PASSED },
      }),
      this.prisma.qualityVerification.count({ where: { hotel_id: hotelId } }),
      // ADR-028 (OQ-ANALYTICS-03): basic-analytics "rooms completed per worker"
      // for this hotel, derived from the manager-entered RoomsCompletedEntry.
      this.prisma.roomsCompletedEntry.aggregate({
        where: { hotel_id: hotelId },
        _sum: { rooms_completed: true },
        _count: true,
      }),
      this.getLeaderboard(hotelId),
    ]);

    const attMap = new Map(
      (
        todayAttendanceGroups as Array<{ status: AttendanceStatus; _count: { id: number } }>
      ).map((a) => [a.status, a._count.id])
    );

    const aggResult = openRequestsAgg as {
      _count: { id: number };
      _sum: { workers_needed: number | null; workers_confirmed: number | null };
    };
    const qualAvg = (qualityAgg as { _avg: { score: number | null } })._avg.score;

    return {
      hotel_id: hotelId,
      open_requests: {
        count: aggResult._count.id,
        workers_needed: aggResult._sum.workers_needed ?? 0,
        workers_confirmed: aggResult._sum.workers_confirmed ?? 0,
      },
      active_assignments: activeAssignments as number,
      today_attendance: {
        expected: attMap.get(AttendanceStatus.EXPECTED) ?? 0,
        present:
          (attMap.get(AttendanceStatus.PRESENT) ?? 0) +
          (attMap.get(AttendanceStatus.LATE) ?? 0),
        late: attMap.get(AttendanceStatus.LATE) ?? 0,
        absent: attMap.get(AttendanceStatus.ABSENT) ?? 0,
      },
      quality: {
        average_score: qualAvg !== null ? Math.round((qualAvg ?? 0) * 100) / 100 : null,
        recent_pass_rate:
          (totalQuality as number) > 0
            ? Math.round(((qualityPassed as number) / (totalQuality as number)) * 10000) / 100
            : 0,
      },
      rooms_completed: {
        total:
          (roomsCompletedAgg as { _sum: { rooms_completed: number | null } })._sum
            .rooms_completed ?? 0,
        entries: (roomsCompletedAgg as { _count: number })._count,
      },
      top_workers: topWorkers.slice(0, 5),
    };
  }
}

export const analyticsService = new AnalyticsService();
