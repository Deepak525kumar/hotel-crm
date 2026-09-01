const fs = require('fs');

async function check() {
  const file = fs.readFileSync('backend/src/modules/users/types.ts', 'utf8');
  console.log("UpdateUserSchema includes email?", file.includes('email: z.'));
}
check();
