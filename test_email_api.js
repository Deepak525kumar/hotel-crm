const fetch = require('node-fetch');

async function testEmail() {
  const loginRes = await fetch('http://localhost:3001/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123' })
  });
  const loginData = await loginRes.json();
  const cookie = loginRes.headers.get('set-cookie');
  
  if (!cookie) {
    console.error("Login failed or no cookie:", loginData);
    return;
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': cookie
  };
  
  // Try to create a user with an existing email
  const createRes = await fetch('http://localhost:3001/users', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      first_name: 'Test',
      last_name: 'User',
      email: 'manager@example.com',
      role: 'manager',
      password: 'password123',
      hotel_id: '1'
    })
  });
  
  console.log("Create user with existing email:", createRes.status, await createRes.text());
  
  // Get users
  const usersRes = await fetch('http://localhost:3001/users?limit=10', { headers });
  const usersData = await usersRes.json();
  const someUser = usersData.data.data.find(u => u.email !== 'manager@example.com');
  
  if (!someUser) {
    console.error("No other user found");
    return;
  }
  
  // Try to update email to an existing one
  const updateRes = await fetch(`http://localhost:3001/users/${someUser.id}/email`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ email: 'manager@example.com' })
  });
  
  console.log("Update user with existing email:", updateRes.status, await updateRes.text());
}

testEmail().catch(console.error);
