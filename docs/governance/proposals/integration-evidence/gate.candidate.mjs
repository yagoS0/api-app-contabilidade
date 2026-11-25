/**
 * CANDIDATE ONLY — not imported by a controller, workflow or merge operation.
 * Pure structural evaluation of evidence already authenticated by the Principal.
 * References/actor names do not authenticate people, API responses or CI results.
 * A satisfied candidate is neither human approval nor authority to merge/deploy.
 */
export const CANDIDATE_POLICY_VERSION = 'integration-evidence-proposal-1';
const TECHNICAL_MAX_AGE_MS = 15 * 60 * 1000;
const OWNER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const unique = (values) => new Set(values).size === values.length;

function instant(value) {
  if (typeof value !== 'string') return NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return NaN;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1
    || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return NaN;
  return Date.parse(value);
}

function fresh(observedAt, now, maxAge) {
  const at = instant(observedAt);
  return Number.isFinite(at) && at <= now && now - at < maxAge;
}

function validScope(scope) {
  return scope && text(scope.repository) && Number.isSafeInteger(scope.pr) && scope.pr > 0
    && sha(scope.headSha) && sha(scope.baseSha) && text(scope.projectId) && text(scope.environmentId)
    && Array.isArray(scope.services) && scope.services.length > 0
    && unique(scope.services.map((service) => service?.id))
    && scope.services.every((service) => service && text(service.id) && text(service.repository)
      && text(service.branch) && text(service.configFingerprint));
}

function sameScope(left, right) {
  if (!validScope(left) || !validScope(right)) return false;
  if (['repository', 'pr', 'headSha', 'baseSha', 'projectId', 'environmentId']
    .some((key) => left[key] !== right[key])) return false;
  if (left.services.length !== right.services.length) return false;
  return left.services.every((service) => {
    const other = right.services.find((entry) => entry.id === service.id);
    return other && ['repository', 'branch', 'configFingerprint'].every((key) => service[key] === other[key]);
  });
}

function result(outcome, reason, evidenceKind = null) {
  return { policyVersion: CANDIDATE_POLICY_VERSION, candidateOnly: true, outcome, reason, evidenceKind };
}

/**
 * Input snapshots must be collected/authenticated outside this proposal. In particular:
 * - target services must include every service whose Git source can react to the merge;
 * - requiredChecks is the authoritative complete check inventory, not just returned jobs;
 * - sourceRef points to retained evidence; neither a boolean nor a guessed identity suffices.
 * No caller can activate the proposal through an input parameter.
 */
export function evaluateIntegrationCandidate(input = {}) {
  if (!input || typeof input !== 'object') return result('blocked', 'invalid_target_or_clock');
  const { target, observed, authorization, technical, ownerConfirmation } = input;
  const now = instant(input.now);
  if (!Number.isFinite(now) || !validScope(target)) return result('blocked', 'invalid_target_or_clock');
  if (!observed || !text(observed.sourceRef) || !fresh(observed.observedAt, now, TECHNICAL_MAX_AGE_MS)) {
    return result('blocked', 'current_state_missing_or_stale');
  }
  if (observed.headSha !== target.headSha || observed.baseSha !== target.baseSha) {
    return result('blocked', 'sha_or_base_changed');
  }
  if (observed.mergeable !== true || observed.configurationUnchanged !== true) {
    return result('blocked', 'conflict_or_configuration_change');
  }
  const ci = observed.ci;
  if (!ci || ci.headSha !== target.headSha || ci.complete !== true
    || !Array.isArray(ci.requiredChecks) || !ci.requiredChecks.length
    || !ci.requiredChecks.every(text) || !unique(ci.requiredChecks)
    || !Array.isArray(ci.checks) || !unique(ci.checks.map((check) => check?.name))
    || !ci.checks.every((check) => check && text(check.name) && check.headSha === target.headSha
      && check.status === 'completed' && check.conclusion === 'success')
    || ci.requiredChecks.some((name) => !ci.checks.some((check) => check?.name === name
      && check.headSha === target.headSha && check.status === 'completed' && check.conclusion === 'success'))) {
    return result('blocked', 'ci_incomplete_or_not_successful');
  }
  if (!authorization || authorization.action !== 'squash_merge' || authorization.revoked !== false
    || !text(authorization.actor) || !text(authorization.sourceRef)
    || !Number.isFinite(instant(authorization.recordedAt)) || instant(authorization.recordedAt) > now
    || ['repository', 'pr', 'headSha', 'baseSha'].some((key) => authorization[key] !== target[key])) {
    return result('blocked', 'integration_authorization_missing_or_mismatched');
  }
  // A relevant enabled trigger must never be overridden by an owner declaration.
  if (technical?.kind === 'technical' && technical.projectId === target.projectId
    && technical.environmentId === target.environmentId && Array.isArray(technical.states)
    && technical.states.some((entry) => target.services.some((service) => service.id === entry?.serviceId)
      && entry.autoDeploy === 'enabled')) {
    return result('blocked', 'automatic_deploy_enabled', 'technical');
  }
  if (!technical || technical.kind !== 'technical' || !text(technical.sourceRef)
    || technical.projectId !== target.projectId || technical.environmentId !== target.environmentId) {
    return result('inconclusive', 'technical_observation_missing_or_mismatched');
  }
  if (technical.status === 'available') {
    if (!fresh(technical.observedAt, now, TECHNICAL_MAX_AGE_MS)) {
      return result('inconclusive', 'technical_observation_missing_or_stale');
    }
    const states = technical.states;
    if (!sameScope(technical.scope, target) || technical.complete !== true || !Array.isArray(states)
      || states.length !== target.services.length || !unique(states.map((entry) => entry?.serviceId))
      || !target.services.every((service) => states.some((entry) => entry?.serviceId === service.id
        && entry.autoDeploy === 'disabled'))) {
      return result('inconclusive', 'technical_observation_incomplete');
    }
    return result('candidate_satisfied', 'technical_evidence_complete', 'technical');
  }
  if (technical.status !== 'unavailable'
    || !['not_authorized', 'credential_rejected', 'capability_not_exposed', 'transport_error',
      'partial_response', 'graphql_error', 'schema_unknown'].includes(technical.reason)) {
    return result('inconclusive', 'technical_status_unknown');
  }
  // registeredAt records inspection of the known limitation, NOT another request.
  // A rejected credential must not be retried merely to refresh this record.
  // Normalizers must retain any enabled states even in partial/error responses.
  if (!text(technical.originalFailureRef) || !Number.isFinite(instant(technical.observedAt))
    || instant(technical.observedAt) > instant(technical.registeredAt)
    || !fresh(technical.registeredAt, now, OWNER_MAX_AGE_MS)) {
    return result('inconclusive', 'technical_limitation_not_documented');
  }
  const owner = ownerConfirmation;
  const expires = instant(owner?.expiresAt);
  const observedAt = instant(owner?.observedAt);
  if (!owner || owner.kind !== 'owner' || owner.state !== 'disabled' || owner.revoked !== false
    || owner.method !== 'railway_panel' || !text(owner.actor) || !text(owner.sourceRef)
    || !sameScope(owner.scope, target) || !fresh(owner.observedAt, now, OWNER_MAX_AGE_MS)
    || !Number.isFinite(expires) || expires <= now || expires <= observedAt
    || expires - observedAt > OWNER_MAX_AGE_MS) {
    return result('blocked', 'owner_confirmation_missing_invalid_or_expired', 'owner');
  }
  return result('candidate_satisfied', 'owner_confirmation_with_technical_limitation', 'owner');
}

/** A new deployment is an incident to investigate, not proof that this merge caused it. */
export function compareDeploymentSnapshotsCandidate(input = {}) {
  const { scope, before, after, now, mergedAt } = input ?? {};
  const timestamp = instant(now);
  const mergedTimestamp = instant(mergedAt);
  if (!validScope(scope) || !Number.isFinite(timestamp) || !Number.isFinite(mergedTimestamp)) {
    return result('inconclusive', 'invalid_monitor_scope');
  }
  function validSnapshot(snapshot) {
    return snapshot && snapshot.complete === true && text(snapshot.sourceRef)
      && sameScope(snapshot.scope, scope) && Number.isFinite(instant(snapshot.observedAt))
      && instant(snapshot.observedAt) <= timestamp && Array.isArray(snapshot.services)
      && snapshot.services.length === scope.services.length
      && unique(snapshot.services.map((service) => service?.id))
      && scope.services.every((service) => snapshot.services.some((entry) => entry?.id === service.id
        && Array.isArray(entry.deploymentIds) && entry.deploymentIds.every(text) && unique(entry.deploymentIds)));
  }
  if (!validSnapshot(before) || !validSnapshot(after) || instant(before.observedAt) > mergedTimestamp
    || instant(after.observedAt) < mergedTimestamp) {
    return result('inconclusive', 'deployment_history_incomplete_or_invalid');
  }
  if (before.services.some((service) => service.deploymentIds.some((id) =>
    !after.services.find((entry) => entry.id === service.id).deploymentIds.includes(id)))) {
    return result('inconclusive', 'deployment_history_lost_baseline_entries');
  }
  const newDeployments = after.services.flatMap((service) => {
    const existing = new Set(before.services.find((entry) => entry.id === service.id).deploymentIds);
    return service.deploymentIds.filter((id) => !existing.has(id)).map((id) => ({ serviceId: service.id, deploymentId: id }));
  });
  if (newDeployments.length) return { ...result('stop_for_investigation', 'new_deployment_observed'), newDeployments };
  return { ...result('candidate_satisfied', 'no_new_deployment_in_observed_history'), newDeployments: [] };
}
