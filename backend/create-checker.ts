import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('DemoChecker123!', 10);
  
  const checker = await prisma.user.create({
    data: {
      email: 'checker.demo@hotelcrm.local',
      first_name: 'Demo',
      last_name: 'Checker',
      password_hash: passwordHash,
      role: 'checker',
    }
  });

  const hotelGroup = await prisma.hotelGroup.findFirst();
  if (hotelGroup) {
    await prisma.employmentRecord.create({
      data: {
        user_id: checker.id,
        hotel_group_id: hotelGroup.id,
        status: 'ACTIVE'
      }
    });
  }

  console.log(`Created Checker:\nEmail: checker.demo@hotelcrm.local\nPassword: DemoChecker123!`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
