// Test-only guard. No production module imports this helper.
const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const refuse = () => { throw new Error('Disposable PostgreSQL identity refused'); };
export function assertDisposablePostgres({ raw, actual, env = process.env }) {
  if (env.NODE_ENV !== 'test' || typeof raw !== 'string' || !raw) refuse();
  let url;
  try { url = new URL(raw); } catch { refuse(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) refuse();
  if (!actual || actual.name !== url.pathname.slice(1) || !url.username || actual.username !== decodeURIComponent(url.username)) refuse();
  if (loopback.includes(actual.address)) return;
  // Observed Docker service identity of the existing usability-regression job.
  // A different CI topology must be reviewed explicitly, not inferred from RFC1918.
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_JOB !== 'usability-regression'
    || url.hostname !== '127.0.0.1' || url.port !== '55490'
    || url.pathname !== '/usability_governance_test' || url.username !== 'usability_test'
    || actual.username !== 'usability_test' || Number(actual.port) !== 5432
    || !/^15[0-9]{4}$/.test(String(actual.versionNumber)) || actual.address !== '172.18.0.2') refuse();
}
