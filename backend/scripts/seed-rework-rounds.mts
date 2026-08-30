/**
 * Dummy multi-round rework data, so the new screens have something to show.
 *
 * DEV ONLY and it says so: it refuses to run against anything but a local
 * database, because it writes fabricated inspections and would otherwise be
 * one careless DATABASE_URL away from putting invented quality records on a
 * real worker's rating.
 *
 * Idempotent by room number: re-running replaces its own rooms rather than
 * stacking a second copy.
 */
import { loadEnv } from '../src/config/env.js';
import { connectDb, disconnectDb, getPrisma } from '../src/lib/db.js';

loadEnv();

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('Refusing to seed: DATABASE_URL is not a local database.');
  console.error('This writes fabricated inspections and ratings.');
  process.exit(1);
}

await connectDb();
const prisma = getPrisma();

const ROOMS = ['SEED-201', 'SEED-202', 'SEED-203'];

const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
const hotel = await prisma.hotel.findFirstOrThrow();
// A real account, not a throwaway. Probe scripts leave users behind on
// @invalid.local addresses, and seeding onto one of those produces data nobody
// can log in and look at -- which defeats the point of seeding it.
const REAL = { NOT: { email: { endsWith: '@invalid.local' } } };
// Prefer the obvious demo logins (worker1@, checker1@) so the seeded data
// lands where someone would naturally go looking for it; fall back to any real
// account of that role.
const pick = async (role: 'WORKER' | 'CHECKER', prefix: string) =>
  (await prisma.user.findFirst({
    where: { role, ...REAL, email: { startsWith: prefix } },
    orderBy: { email: 'asc' },
  })) ?? prisma.user.findFirst({ where: { role, ...REAL }, orderBy: { email: 'asc' } });

const worker = await pick('WORKER', 'worker');
const checker = await pick('CHECKER', 'checker');
if (!worker || !checker) {
  console.error('Need at least one WORKER and one CHECKER in the database.');
  process.exit(1);
}

// Clear anything a previous run left, so this is safe to repeat.
const old = await prisma.qualityVerification.findMany({
  where: { room_number: { in: ROOMS } },
  select: { id: true, assignment_id: true },
});
if (old.length) {
  await prisma.workerAssignment.deleteMany({
    where: { rework_verification_id: { in: old.map((o) => o.id) } },
  });
  await prisma.qualityVerification.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  console.log(`cleared ${old.length} previous seeded check(s)`);
}

const day = new Date();
day.setUTCHours(0, 0, 0, 0);

const shift = await prisma.workerAssignment.create({
  data: {
    worker_id: worker.id,
    hotel_id: hotel.id,
    assigned_by_id: admin.id,
    day,
    status: 'IN_PROGRESS',
  },
});

// Fabricated storage keys. They will render as "photo unavailable" unless a
// bucket is configured -- which is the honest outcome: the screens are being
// exercised, not the storage layer.
const key = (n: string) => `quality/seed/${n}.jpg`;

async function makeCheck(room: string, score: number, notes: string) {
  return prisma.qualityVerification.create({
    data: {
      assignment_id: shift.id,
      hotel_id: hotel.id,
      verified_by_id: checker!.id,
      worker_id: worker!.id,
      room_number: room,
      score,
      status: score >= 70 ? 'PASSED' : 'NEEDS_REWORK',
      notes,
      criteria_scores: { bathroom: score, floor: score + 5, mirror: score - 5 },
      photo_urls: [key(`${room}-checker-1`), key(`${room}-checker-2`)],
      rework_required: false,
    },
  });
}

async function addRound(
  verificationId: string,
  roundNumber: number,
  notes: string,
  completed: boolean,
  room: string
) {
  const reworkShift = await prisma.workerAssignment.create({
    data: {
      worker_id: worker!.id,
      hotel_id: hotel.id,
      assigned_by_id: checker!.id,
      day,
      status: completed ? 'COMPLETED' : 'CONFIRMED',
      rework_of_assignment_id: shift.id,
      rework_verification_id: verificationId,
      ...(completed ? { completed_at: new Date() } : {}),
    },
  });
  await prisma.reworkRound.create({
    data: {
      verification_id: verificationId,
      round_number: roundNumber,
      notes,
      assigned_by_id: checker!.id,
      assignment_id: reworkShift.id,
      completed_at: completed ? new Date() : null,
      photo_urls: completed ? [key(`${room}-round${roundNumber}`)] : [],
    },
  });
  await prisma.qualityVerification.update({
    where: { id: verificationId },
    data: {
      rework_required: true,
      rework_notes: notes,
      rework_completed_at: completed ? new Date() : null,
      status: 'NEEDS_REWORK',
    },
  });
}

// 1. Two completed rounds, then a third still open -- the full history the
//    grouped evidence screens exist to show.
const a = await makeCheck(ROOMS[0]!, 35, 'Bathroom not cleaned, hair in the shower');
await addRound(a.id, 1, 'Redo the bathroom, especially the shower', true, ROOMS[0]!);
await addRound(a.id, 2, 'Shower is better but the mirror is still smeared', true, ROOMS[0]!);
await addRound(a.id, 3, 'Mirror still not done', false, ROOMS[0]!);

// 2. One completed round -- the "rework completed" state on the shift screen.
const b = await makeCheck(ROOMS[1]!, 55, 'Bed linen not changed');
await addRound(b.id, 1, 'Change the bed linen', true, ROOMS[1]!);

// 3. A clean pass, so the screens are exercised with no rework section at all.
await makeCheck(ROOMS[2]!, 92, 'Spotless');

console.log(`
Seeded on shift ${shift.id}
  worker  : ${worker.first_name} ${worker.last_name} <${worker.email}>
  checker : ${checker.first_name} ${checker.last_name} <${checker.email}>
  hotel   : ${hotel.name}

  ${ROOMS[0]}  score 35  3 rounds (2 completed, round 3 OPEN)
  ${ROOMS[1]}  score 55  1 round  (completed)
  ${ROOMS[2]}  score 92  no rework
`);
await disconnectDb();
