import crypto from 'crypto';

export async function runConcurrencyTest() {
  const BASE = 'http://localhost:3001/api/v1';
  
  // Create an admin user token directly or login if seed users exist.
  // Wait, the DB was seeded with admin in scenario 00.
  // I can just login as E2E-M-01 (Manager) or E2E-A-01 (Admin) and E2E-W-01 (Worker).
  
  // Let's authenticate first.
  const login = async (email) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' })
    });
    const data = await res.json();
    return data.accessToken;
  };

  const adminToken = await login('admin@hotelcrm.local').catch(() => null);
  if (!adminToken) {
    console.error('Failed to login. Is server running and seeded?');
    return;
  }
  
  console.log('✅ Logged in as admin');

  // We need an employee record for testing N-Way Race.
  // Let's fetch an applicant.
  const employeesRes = await fetch(`${BASE}/employees`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const employees = await employeesRes.json();
  const pendingEmp = employees.data?.find(e => e.status === 'PENDING');
  
  if (!pendingEmp) {
    console.error('❌ No PENDING employee found for concurrency test.');
    return;
  }

  console.log(`Testing N-Way Approval Race on employee: ${pendingEmp.user_id}`);

  // Fire 50 simultaneous approvals
  const requests = [];
  for (let i = 0; i < 50; i++) {
    requests.push(
      fetch(`${BASE}/employees/${pendingEmp.user_id}/approve`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({})
      }).then(r => r.status)
    );
  }

  const results = await Promise.all(requests);
  const successCount = results.filter(s => s === 200 || s === 201).length;
  const conflictCount = results.filter(s => s === 409).length;

  console.log(`Results: ${successCount} succeeded, ${conflictCount} conflicts, ${results.length - successCount - conflictCount} other errors.`);
  
  // EXPECTED SUCCESS ENVELOPE:
  // Out of 50 parallel requests, exactly 1 should succeed (status 200/201).
  // The remaining 49 MUST fail with a 409 Conflict due to optimistic concurrency control
  // and the database's version column validation.
  if (successCount === 1 && conflictCount === 49) {
    console.log('✅ N-Way Approval Race PASSED: exactly 1 request succeeded.');
  } else {
    console.log(`❌ N-Way Approval Race FAILED. Expected 1 success and 49 conflicts, got ${successCount} successes and ${conflictCount} conflicts.`);
  }

  // TODO: Assign vs Deactivate Race on an Active Manager
  const activeManager = employees.data?.find(e => e.status === 'ACTIVE' && e.user.role === 'MANAGER');
  if (activeManager) {
    console.log(`Testing Assign vs Deactivate Race on manager: ${activeManager.user_id}`);
    
    // Assign body
    const hotelsRes = await fetch(`${BASE}/hotels`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const hotels = await hotelsRes.json();
    const hotelId = hotels.data?.[0]?.id;

    if (hotelId) {
      const p1 = fetch(`${BASE}/employees/${activeManager.user_id}/assign`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ primary_hotel_id: hotelId })
      }).then(r => r.status);

      const p2 = fetch(`${BASE}/employees/${activeManager.user_id}/deactivate`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ reason: 'race_condition_test' })
      }).then(r => r.status);

      const [resAssign, resDeactivate] = await Promise.all([p1, p2]);
      console.log(`Assign: ${resAssign}, Deactivate: ${resDeactivate}`);
      
      const checkRes = await fetch(`${BASE}/employees/${activeManager.user_id}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const updated = await checkRes.json();
      console.log(`Final state: Status=${updated.status}, Hotel=${updated.primary_hotel_id}`);
      
      const hotelCheck = await fetch(`${BASE}/hotels/${hotelId}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const updatedHotel = await hotelCheck.json();
      console.log(`Hotel manager id: ${updatedHotel.manager_user_id}`);
      
      if (
        (updated.status === 'DEACTIVATED' && !updatedHotel.manager_user_id) || 
        (updated.status === 'ACTIVE' && updatedHotel.manager_user_id === activeManager.user_id)
      ) {
         console.log('✅ Assign vs Deactivate Race PASSED: Final state is internally consistent.');
      } else {
         console.log('❌ Assign vs Deactivate Race FAILED: Inconsistent state!');
      }
    }
  } else {
    console.log('⚠️ No active manager found for Assign vs Deactivate test.');
  }

}

runConcurrencyTest();
