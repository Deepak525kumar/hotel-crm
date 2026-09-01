import { UserRole } from '@prisma/client';
import { getPrisma, connectDb, disconnectDb } from './src/lib/db.js';
import { loadEnv } from './src/config/env.js';
import { authService } from './src/modules/auth/service.js';
import { userService } from './src/modules/users/service.js';

async function main() {
  loadEnv();
  await connectDb();
  const prisma = getPrisma();
  
  console.log("Setting up live test data...");

  // 1. Create Users
  const worker = await prisma.user.create({
    data: {
      id: 'live-test-worker-final',
      email: 'live-worker-final@example.com',
      first_name: 'Live',
      last_name: 'Worker',
      password_hash: 'hash',
      role: UserRole.WORKER,
    }
  });

  console.log("Mock data created!");

  try {
    console.log("\n[1] Testing Reset Password...");
    await authService.requestPasswordReset({ email: 'live-worker-final@example.com' });
    
    console.log("\n[2] Testing Email Update...");
    // wait for 1 second to distinguish timestamps
    await new Promise(r => setTimeout(r, 1000));
    await userService.updateUserEmail(worker.id, { email: 'live-worker-updated@example.com' }, worker.id, 'WORKER', null);

    // Fetch Outbox Events
    const events = await prisma.outboxEvent.findMany({
      orderBy: { created_at: 'desc' },
      take: 5
    });

    console.log("\n--- Outbox Events Generated ---");
    for (const e of events) {
      console.log(`[${e.created_at.toISOString()}] Type: ${e.event_type} | Transport: ${e.transport} | Source: ${e.source_module}`);
      if (e.payload) console.log(`    Payload:`, JSON.stringify(e.payload));
    }

  } finally {
    // Cleanup
    console.log("\nCleaning up...");
    await prisma.outboxEvent.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.passwordResetToken.deleteMany({ where: { user_id: worker.id } });
    await prisma.user.deleteMany({ where: { id: worker.id } });
    await disconnectDb();
    console.log("Done!");
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
