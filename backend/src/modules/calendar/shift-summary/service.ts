import { z } from 'zod';
import { getPrisma } from '../../../lib/db.js';

export const dailyShiftSummarySchema = z.object({
  total_rooms: z.number().int().min(0),
  stay_over_rooms: z.number().int().min(0),
  checkout_rooms: z.number().int().min(0),
  total_people_working: z.number().int().min(0),
  notes: z.string().optional().nullable(),
});

export type DailyShiftSummaryPayload = z.infer<typeof dailyShiftSummarySchema>;

export class ShiftSummaryService {
  async getSummariesByDateRange(hotel_id: string, start_date: Date, end_date: Date) {
    const prisma = getPrisma();
    return prisma.dailyShiftSummary.findMany({
      where: {
        hotel_id,
        date: {
          gte: start_date,
          lte: end_date,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });
  }

  async upsertSummary(
    hotel_id: string,
    date: Date,
    payload: DailyShiftSummaryPayload,
    actor_id: string
  ) {
    const prisma = getPrisma();
    
    return prisma.dailyShiftSummary.upsert({
      where: {
        hotel_id_date: {
          hotel_id,
          date,
        },
      },
      update: {
        ...payload,
        updated_by_id: actor_id,
      },
      create: {
        hotel_id,
        date,
        ...payload,
        created_by_id: actor_id,
      },
    });
  }
}
