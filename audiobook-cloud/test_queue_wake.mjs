import assert from 'node:assert/strict';
import fs from 'node:fs';
const code = fs.readFileSync('queue_wake.js', 'utf8');
const { wakeQueue } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const time = Date.parse('2026-10-06T21:40:00Z');
async function run(responses, token='test-token') {
  let calls = [], dispatched = 0, logs = [];
  const db = { from() {
    const chain = new Proxy({}, { get(_, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(responses.shift()).then(resolve, reject);
      return (...args) => { calls.push([prop, ...args]); return chain; };
    }}); return chain;
  }};
  const result = await wakeQueue(db, token, async (...a) => logs.push(a), {
    now: () => time, sleep: async () => {},
    request: async (url, options) => {
      dispatched++;
      assert.equal(options.body, '{"ref":"main"}');
      assert.ok(!options.body.includes('test-token'));
      return { ok: true };
    }
  });
  return { result, dispatched, logs, calls };
}
assert.equal((await run([], '')).result.state, 'not_configured');
assert.equal((await run([{data:[{id:'active',last_heartbeat_at:new Date(time).toISOString()}]}])).dispatched, 0);
const queued={id:'job',stage:'waiting_for_cloud_worker',updated_at:new Date(time-1000).toISOString()};
const successful=await run([{data:[]},{data:queued},{data:{id:'job'}},{data:[{id:'job',last_heartbeat_at:new Date(time).toISOString()}]}]);
assert.equal(successful.dispatched,1);
assert.equal(successful.result.state,'running');
assert.equal(successful.logs[1][2],'WORKER_START_CONFIRMED');
assert.equal((await run([{data:[]},{data:queued},{data:null}])).dispatched,0);
assert.equal((await run([{data:[]},{data:{...queued,stage:'worker_start_requested'}}])).dispatched,0);
console.log('PASS: no secret, active worker, dispatch verification, concurrent lock, retry throttle');
