import {
  AssignmentStatus,
  WorkRequestStatus,
  AttendanceStatus,
  VerificationStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { DashboardStats, HotelSummary, LeaderboardEntry, WorkerStats } from './types.js';
import { deriveRatingTier } from '../quality/rating-tiers.js';

interface OverallRatingRow {
  worker_id: string;
  average_score: number;
  total_ratings: number;
  total_assignments: number;
  completion_rate: number;
  worker: { first_name: string; last_name: string };
}

// GD-06 enhancement (2026-08-09): getWorkerStats()'s recent_ratings is a
// summary-widget slice, not the worker's full rating history -- capped so
// the self-scoped /my-stats response stays small regardless of tenure.
const RECENT_RATINGS_LIMIT = 5;

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
      const displayScore = Math.round(row.average_score * 100) / 100;
      return {
        worker_id: row.worker_id,
        name: `${row.worker.first_name} ${row.worker.last_name}`,
        total_tasks: total,
        completed_tasks: Math.round(row.completion_rate * total),
        average_rating: displayScore,
        // TREQ-003: the tier is derived, never stored -- see rating-tiers.ts.
        //
        // Derived from the SAME rounded value that is returned, not from the
        // raw one. Deriving from the raw score let a single response say
        // `average_rating: 90.00` and `rating_tier: "HIGH"` at the same time:
        // 89.9955 rounds up across the ELITE boundary for display while the
        // tier is still computed on the pre-rounded number. Every boundary has
        // that 0.005-wide window, and the leaderboard shows both fields side
        // by side, so it reads as the badge being broken.
        //
        // Passing total_ratings is what keeps an unrated worker out of
        // PROBATION: their average_score is 0, which would otherwise read as
        // the worst possible standing on their first day.
        rating_tier: deriveRatingTier(displayScore, row.total_ratings),
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
      roomsCompletedAgg,
      roomLogCount,
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
      // ADR-028 (OQ-ANALYTICS-03): basic-analytics "rooms completed per worker",
      // derived from the manager-entered RoomsCompletedEntry.
      //
      // Kept as HISTORY, not retired (2026-09-01). Rooms are now logged
      // room-by-room by the worker (RoomLog, counted below) and the manual
      // entry is no longer offered in the UI -- but every shift before that
      // change has its count only here. Reading room logs alone would make
      // all historical figures collapse to zero, which reads as data loss to
      // anyone looking at a trend. The two sources are mutually exclusive per
      // assignment (a shift is logged one way or the other), so adding them
      // cannot double-count.
      this.prisma.roomsCompletedEntry.aggregate({
        where: scope,
        _sum: { rooms_completed: true },
        _count: true,
      }),
      this.prisma.roomLog.count({ where: scope }),
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
    // Since the Rating merge (2026-08-29) the average score and the pass rate
    // are two readings of ONE table, so this reuses the aggregate above rather
    // than running an identical second query. Both tiles the UI draws from
    // them stay populated -- and, unlike before, they can no longer disagree
    // about the same inspections.
    const ratingAvg = (qualityAgg as { _avg: { score: number | null } })._avg.score;
    const totalRatings = totalQuality;

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
        // Legacy manager-entered counts (history) + worker-logged rooms (now).
        // See the aggregate above for why both.
        total:
          ((roomsCompletedAgg as { _sum: { rooms_completed: number | null } })._sum
            .rooms_completed ?? 0) + (roomLogCount as number),
        entries: (roomsCompletedAgg as { _count: number })._count + (roomLogCount as number),
      },
    };
  }

  // GD-06: worker-scoped analytics (own stats only), resolving the
  // mobile-worker dashboard's previously-silent 403 against the
  // admin/manager-only /stats route. Server-scoped to workerId — the caller
  // (controller) must pass only req.auth.userId, never a client-supplied id.
  async getWorkerStats(workerId: string): Promise<WorkerStats> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      completedAssignments,
      totalAssignments,
      roomsCompletedAgg,
      workerRoomLogCount,
      overallRating,
      attendanceByStatus,
      totalAttendance,
      monthAssignments,
      monthCompleted,
      monthRatingAgg,
      recentRatings,
    ] = await Promise.all([
      // ADR-069 §3: rework assignments are excluded from a worker's OWN
      // counts, for the same reason they are excluded from
      // completion_rate/on_time_rate -- a rework row is a second row for work
      // already counted once, so including it reports two completed
      // assignments for one room.
      //
      // Consistency is the sharper argument here than double-counting: this
      // same response also returns `average_score` from WorkerOverallRating,
      // which DOES exclude rework. Counting it in one field and not the other
      // would have this endpoint contradict itself in a single payload.
      this.prisma.workerAssignment.count({
        where: {
          worker_id: workerId,
          status: AssignmentStatus.COMPLETED,
          rework_of_assignment_id: null,
        },
      }),
      this.prisma.workerAssignment.count({
        where: { worker_id: workerId, rework_of_assignment_id: null },
      }),
      // Legacy manager-entered counts, kept for history -- see the platform
      // aggregate's note. The worker-logged rooms are counted alongside.
      this.prisma.roomsCompletedEntry.aggregate({
        where: { worker_id: workerId },
        _sum: { rooms_completed: true },
      }),
      this.prisma.roomLog.count({ where: { worker_id: workerId } }),
      this.prisma.workerOverallRating.findUnique({
        where: { worker_id: workerId },
        select: { average_score: true, total_ratings: true },
      }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: { worker_id: workerId },
        _count: { id: true },
      }),
      this.prisma.attendance.count({ where: { worker_id: workerId } }),
      // WorkerAssignment has no created_at column -- confirmed_at is the
      // closest analog (set once at creation, @default(now()), never
      // updated afterward) for "assignment created this month."
      this.prisma.workerAssignment.count({
        where: {
          worker_id: workerId,
          confirmed_at: { gte: monthStart },
          rework_of_assignment_id: null,
        },
      }),
      this.prisma.workerAssignment.count({
        where: {
          worker_id: workerId,
          status: AssignmentStatus.COMPLETED,
          confirmed_at: { gte: monthStart },
          rework_of_assignment_id: null,
        },
      }),
      // Reads checks since the Rating merge (2026-08-29). `worker_id` is a
      // real column on QualityVerification -- denormalized in that migration
      // precisely so these per-worker reads stay index-backed instead of
      // becoming joins through the assignment.
      this.prisma.qualityVerification.aggregate({
        where: { worker_id: workerId, created_at: { gte: monthStart } },
        _avg: { score: true },
      }),
      this.prisma.qualityVerification.findMany({
        where: { worker_id: workerId },
        select: { assignment_id: true, score: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: RECENT_RATINGS_LIMIT,
      }),
    ]);

    const attMap = new Map(
      (attendanceByStatus as Array<{ status: AttendanceStatus; _count: { id: number } }>).map(
        (a) => [a.status, a._count.id]
      )
    );
    const present = attMap.get(AttendanceStatus.PRESENT) ?? 0;
    const late = attMap.get(AttendanceStatus.LATE) ?? 0;
    const absent = attMap.get(AttendanceStatus.ABSENT) ?? 0;

    return {
      completed_assignments: completedAssignments,
      rooms_completed:
        ((roomsCompletedAgg as { _sum: { rooms_completed: number | null } })._sum
          .rooms_completed ?? 0) + (workerRoomLogCount as number),
      average_rating: overallRating?.average_score ?? null,
      rating_tier: overallRating
        ? deriveRatingTier(overallRating.average_score, overallRating.total_ratings)
        : null,
      attendance: {
        total: totalAttendance,
        present,
        late,
        absent,
      },
      total_assignments: totalAssignments,
      attendance_rate:
        totalAttendance > 0 ? Math.round(((present + late) / totalAttendance) * 100 * 100) / 100 : null,
      current_month: {
        assignments: monthAssignments,
        completed: monthCompleted,
        average_rating:
          (monthRatingAgg as { _avg: { score: number | null } })._avg.score ?? null,
      },
      recent_ratings: (
        recentRatings as Array<{ assignment_id: string; score: number; created_at: Date }>
      ).map((r) => ({
        assignment_id: r.assignment_id,
        rating: r.score,
        created_at: r.created_at.toISOString(),
      })),
    };
  }

  async getHotelSummary(hotelId: string): Promise<HotelSummary> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      openRequestsAgg,
      confirmedSlotsAgg,
      activeAssignments,
      todayAttendanceGroups,
      qualityAgg,
      qualityPassed,
      totalQuality,
      roomsCompletedAgg,
      hotelRoomLogCount,
      topWorkers,
    ] = await Promise.all([
      this.prisma.jobRequest.aggregate({
        where: {
          hotel_id: hotelId,
          status: { in: [WorkRequestStatus.OPEN, WorkRequestStatus.PARTIALLY_FILLED] },
        },
        _count: { id: true },
        _sum: { workers_needed: true },
      }),
      // Confirmed headcount comes from JobRequestSkillSlot.confirmed_count,
      // NOT JobRequest.workers_confirmed (2026-08-07). That column is
      // declared and read but written by nothing anywhere in the codebase,
      // so this aggregate previously reported confirmed staffing as 0 for
      // every hotel, always -- a dashboard that showed "N needed, 0
      // confirmed" no matter how fully staffed the shifts were.
      //
      // confirmed_count IS maintained correctly: acceptBroadcast()
      // increments it (job-requests/service.ts) and cancelling a
      // broadcast-derived assignment decrements it (assignments/service.ts),
      // so the real figure was already available one table over.
      this.prisma.jobRequestSkillSlot.aggregate({
        where: {
          job_request: {
            hotel_id: hotelId,
            status: { in: [WorkRequestStatus.OPEN, WorkRequestStatus.PARTIALLY_FILLED] },
          },
        },
        _sum: { confirmed_count: true },
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
      // Kept for history alongside the worker-logged count -- see the platform
      // aggregate's note.
      this.prisma.roomsCompletedEntry.aggregate({
        where: { hotel_id: hotelId },
        _sum: { rooms_completed: true },
        _count: true,
      }),
      this.prisma.roomLog.count({ where: { hotel_id: hotelId } }),
      this.getLeaderboard(hotelId),
    ]);

    const attMap = new Map(
      (
        todayAttendanceGroups as Array<{ status: AttendanceStatus; _count: { id: number } }>
      ).map((a) => [a.status, a._count.id])
    );

    const aggResult = openRequestsAgg as {
      _count: { id: number };
      _sum: { workers_needed: number | null };
    };
    const confirmedResult = confirmedSlotsAgg as {
      _sum: { confirmed_count: number | null };
    };
    const qualAvg = (qualityAgg as { _avg: { score: number | null } })._avg.score;

    return {
      hotel_id: hotelId,
      open_requests: {
        count: aggResult._count.id,
        workers_needed: aggResult._sum.workers_needed ?? 0,
        workers_confirmed: confirmedResult._sum.confirmed_count ?? 0,
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
          ((roomsCompletedAgg as { _sum: { rooms_completed: number | null } })._sum
            .rooms_completed ?? 0) + (hotelRoomLogCount as number),
        entries: (roomsCompletedAgg as { _count: number })._count + (hotelRoomLogCount as number),
      },
      top_workers: topWorkers.slice(0, 5),
    };
  }
}

export const analyticsService = new AnalyticsService();
