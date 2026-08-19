import { readFileSync } from 'node:fs';

// ADR-069 §3 applied across surfaces, not just inside the rating aggregate.
//
// /analytics/my-stats returns a worker's own completed/total counts AND
// `average_score` from WorkerOverallRating in the SAME payload. The rating
// aggregate excludes rework rows; if these counts did not, one response would
// contradict itself -- two completed assignments for one room next to a
// completion rate computed from one.
//
// Platform-wide tiles are deliberately NOT filtered: those measure operational
// volume ("how much work happened"), where a rework genuinely is another unit
// of work. The distinction is per-WORKER attribution vs total throughput.
describe('rework exclusion reaches the per-worker analytics counts', () => {
  const src = readFileSync('src/modules/analytics/service.ts', 'utf8');

  it('excludes rework from the worker lifetime counts', () => {
    const lifetime = src.slice(
      src.indexOf('this.prisma.workerAssignment.count({\n        where: {\n          worker_id: workerId,'),
    );
    expect(lifetime.slice(0, 400)).toContain('rework_of_assignment_id: null');
  });

  it('excludes rework from every per-worker assignment count in getWorkerStats', () => {
    // Each workerAssignment.count in this block must carry the filter; a new
    // one added without it silently reintroduces the divergence.
    const block = src.slice(src.indexOf('async getWorkerStats'), src.indexOf('async getWorkerStats') + 4000);
    const counts = block.split('this.prisma.workerAssignment.count(').slice(1);
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) {
      expect(c.slice(0, 300)).toContain('rework_of_assignment_id: null');
    }
  });
});
