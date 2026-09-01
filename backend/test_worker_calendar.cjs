const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const worker = await prisma.user.findFirst({
    where: { role: 'WORKER' }
  });
  console.log("Worker:", worker.id);
  
  const entries = await prisma.calendarEntry.findMany({
    where: { worker_id: worker.id }
  });
  console.log("Calendar Entries for worker:", entries.length);
  
  const assignments = await prisma.workerAssignment.findMany({
    where: { worker_id: worker.id }
  });
  console.log("Worker Assignments for worker:", assignments.length);
}

main().finally(() => prisma.$disconnect());
