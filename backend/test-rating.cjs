async function run() {
  const form = new FormData();
  form.append('assignment_id', 'test-assignment-id');
  form.append('worker_id', 'test-worker-id');
  form.append('score', '85');
  form.append('criteria_scores', JSON.stringify({ dust: 100, bathroom: 0 }));
  form.append('photos', new Blob(['test']), 'test.jpg');

  try {
    const res = await fetch('http://localhost:3001/v1/quality/ratings', {
      method: 'POST',
      body: form
    });
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
