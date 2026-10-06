// No manuscripts, titles, audio links or credentials enter GitHub payloads.
export async function wakeQueue(db, token, logEvent, options = {}) {
  if (!token) return { state: 'not_configured' };
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const request = options.request || fetch;
  const checkActive = async () => {
    const r = await db.from('audiobook_factory_jobs').select('id,last_heartbeat_at')
      .in('status', ['preflight', 'qc_running', 'production', 'finalizing']);
    if (r.error) throw r.error;
    return (r.data || []).some(j => j.last_heartbeat_at && Date.parse(j.last_heartbeat_at) > now() - 30 * 60000);
  };
  if (await checkActive()) return { state: 'running' };
  const q = await db.from('audiobook_factory_jobs').select('id,stage,updated_at')
    .eq('status', 'queued').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) return { state: 'empty' };
  const job = q.data;
  if (job.stage === 'worker_start_requested' && Date.parse(job.updated_at) > now() - 120000)
    return { state: 'requested' };
  // Compare-and-set on the oldest job prevents simultaneous uploads/read polls
  // from dispatching multiple runs. A crashed attempt can be retried in 2 min.
  const lock = await db.from('audiobook_factory_jobs').update({
    stage: 'worker_start_requested', updated_at: new Date(now()).toISOString()
  }).eq('id', job.id).eq('status', 'queued').eq('updated_at', job.updated_at).select('id').maybeSingle();
  if (lock.error) throw lock.error;
  if (!lock.data) return { state: 'requested' };
  try {
    const r = await request('https://api.github.com/repos/Glassface-khan/aj-khan-library/actions/workflows/audiobook-cloud-worker.yml/dispatches', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main' })
    });
    if (!r.ok) throw new Error('DISPATCH_REJECTED');
    await logEvent(job.id, 'info', 'WORKER_START_REQUESTED', 'Private worker start accepted by GitHub.');
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(10000);
      if (await checkActive()) {
        await logEvent(job.id, 'info', 'WORKER_START_CONFIRMED', 'Server confirmed an active audiobook worker.');
        return { state: 'running' };
      }
      const status = await db.from('audiobook_factory_jobs').select('status').eq('id', job.id).maybeSingle();
      if (status.error) throw status.error;
      if (!status.data || status.data.status !== 'queued') return { state: 'changed' };
    }
    await logEvent(job.id, 'warning', 'WORKER_START_DELAYED', 'GitHub accepted the start; worker takeover is still pending.');
    return { state: 'requested' };
  } catch (_) {
    // Do not propagate raw GitHub responses or credentials to logs or clients.
    await logEvent(job.id, 'warning', 'WORKER_START_FAILED', 'Automatic worker start could not be confirmed; queue remains intact.');
    return { state: 'retry_pending' };
  }
}
