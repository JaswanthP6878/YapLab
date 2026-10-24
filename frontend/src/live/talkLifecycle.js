/** Talk intent is separate from the transport: connecting never starts the clock. */
export function createTalkLifecycle(run, { request, changePhase, sendText }) {
  function beginTalk() {
    if (!run.alive || !run.transportConnected) return Promise.reject(new Error('Wait for the live session to connect.'));
    if (['presenting', 'qa'].includes(run.phase)) return run.starting || Promise.resolve();
    if (run.phase !== 'idle') return Promise.reject(new Error('This talk has already ended.'));
    if (run.starting) return run.starting;
    run.starting = Promise.resolve().then(() => request('start')).then((result) => {
      // Update the runtime even after unmount so shutdown can end an in-flight start.
      if (run.phase === 'idle') changePhase('presenting');
      return result;
    }).catch((problem) => {
      run.starting = null;
      throw problem;
    });
    return run.starting;
  }

  return {
    synchronize: () => run.slideSync.synchronize(),
    beginTalk,
    async submitText(text) {
      if (typeof text !== 'string' || !text.trim()) return null;
      await beginTalk();
      if (!run.alive || !run.transportConnected) return null;
      return sendText(text);
    },
    async shutdown() {
      if (!run.socket) return;
      try {
        await run.starting?.catch(() => {});
        if (run.phase === 'presenting') { await request('end_presenting'); run.phase = 'qa'; }
        if (run.phase === 'qa') { await request('end_qa'); run.phase = 'reporting'; }
        if (run.phase === 'reporting') await request('finish');
      } catch { /* A disconnected in-memory session cannot be cancelled over HTTP. */ }
      finally { run.socket.close(); }
    },
  };
}
