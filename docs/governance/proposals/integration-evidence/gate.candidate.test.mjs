import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIntegrationCandidate, compareDeploymentSnapshotsCandidate } from './gate.candidate.mjs';

const NOW = '2026-11-22T15:00:00Z';
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const clone = (value) => structuredClone(value);
function fixture() {
  const target = {
    repository: 'synthetic/altan', pr: 999, headSha: HEAD, baseSha: BASE,
    projectId: 'project-fixture', environmentId: 'production-fixture',
    services: ['api', 'front', 'parser', 'portal'].map((id) => ({ id, repository: 'synthetic/altan', branch: 'main', configFingerprint: `config-${id}-1` })),
  };
  return {
    now: NOW, target,
    observed: {
      headSha: HEAD, baseSha: BASE, observedAt: '2026-11-22T14:59:00Z', sourceRef: 'fixture:github-snapshot',
      mergeable: true, configurationUnchanged: true,
      ci: { headSha: HEAD, complete: true, requiredChecks: ['ci', 'governance'],
        checks: ['ci', 'governance'].map((name) => ({ name, headSha: HEAD, status: 'completed', conclusion: 'success' })) },
    },
    authorization: { action: 'squash_merge', actor: 'synthetic-owner', sourceRef: 'fixture:human-authorization',
      recordedAt: '2026-11-22T14:00:00Z', revoked: false, repository: target.repository, pr: target.pr, headSha: HEAD, baseSha: BASE },
    technical: { kind: 'technical', status: 'available', projectId: target.projectId, environmentId: target.environmentId,
      observedAt: '2026-11-22T14:59:00Z', sourceRef: 'fixture:railway-query', complete: true, scope: clone(target),
      states: target.services.map((service) => ({ serviceId: service.id, autoDeploy: 'disabled' })) },
    ownerConfirmation: { kind: 'owner', state: 'disabled', actor: 'synthetic-owner', sourceRef: 'fixture:panel-declaration',
      method: 'railway_panel', revoked: false, observedAt: '2026-11-22T13:00:00Z', expiresAt: '2026-11-23T13:00:00Z', scope: clone(target) },
  };
}
function unavailableFixture() {
  const input = fixture();
  input.technical.status = 'unavailable';
  input.technical.reason = 'not_authorized';
  input.technical.originalFailureRef = 'fixture:original-rejected-query';
  input.technical.registeredAt = '2026-11-22T14:59:00Z';
  input.technical.states = [];
  input.technical.complete = false;
  return input;
}
function expectReason(input, reason) { assert.equal(evaluateIntegrationCandidate(input).reason, reason); }

test('technical evidence disabled for every service satisfies only the candidate', () => {
  assert.deepEqual(evaluateIntegrationCandidate(fixture()), {
    policyVersion: 'integration-evidence-proposal-1', candidateOnly: true,
    outcome: 'candidate_satisfied', reason: 'technical_evidence_complete', evidenceKind: 'technical',
  });
});
test('enabled automatic deploy wins over a valid owner confirmation', () => {
  const input = fixture(); input.technical.states[0].autoDeploy = 'enabled';
  expectReason(input, 'automatic_deploy_enabled');
});
test('Not Authorized alone does not mean disabled or enabled', () => {
  const input = unavailableFixture(); delete input.ownerConfirmation;
  expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
});
test('specific unexpired owner observation is accepted only with a documented technical limitation', () => {
  const input = unavailableFixture();
  const result = evaluateIntegrationCandidate(input);
  assert.equal(result.outcome, 'candidate_satisfied');
  assert.equal(result.evidenceKind, 'owner');
  assert.equal(input.technical.status, 'unavailable');
});
test('missing owner confirmation blocks the alternative', () => {
  const input = unavailableFixture(); input.ownerConfirmation = null;
  expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
});
test('expired confirmation blocks at the exact expiry boundary', () => {
  const input = unavailableFixture(); input.ownerConfirmation.expiresAt = NOW;
  expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
});
for (const field of ['projectId', 'environmentId', 'repository', 'pr', 'headSha', 'baseSha']) {
  test(`owner confirmation cannot cover a different ${field}`, () => {
    const input = unavailableFixture(); input.ownerConfirmation.scope[field] = field === 'pr' ? 998 : 'different';
    expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
  });
}
test('new service absent from confirmation requires revalidation', () => {
  const input = unavailableFixture(); input.target.services.push({ id: 'new', repository: 'synthetic/altan', branch: 'main', configFingerprint: 'new-1' });
  expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
});
for (const field of ['branch', 'repository', 'configFingerprint']) {
  test(`changed service ${field} invalidates owner confirmation`, () => {
    const input = unavailableFixture(); input.target.services[0][field] = 'changed';
    expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
  });
}
test('explicit configuration change blocks even when a stale fingerprint appears equal', () => {
  const input = unavailableFixture(); input.observed.configurationUnchanged = false;
  expectReason(input, 'conflict_or_configuration_change');
});
test('divergent head and base are independently refused', () => {
  for (const field of ['headSha', 'baseSha']) {
    const input = fixture(); input.observed[field] = 'c'.repeat(40);
    expectReason(input, 'sha_or_base_changed');
  }
});
test('missing, failed, pending, cancelled or differently bound CI cannot satisfy the gate', () => {
  for (const change of [
    (ci) => { ci.complete = false; }, (ci) => { ci.checks.pop(); },
    (ci) => { ci.checks[0].conclusion = 'failure'; }, (ci) => { ci.checks[0].status = 'queued'; },
    (ci) => { ci.checks[0].conclusion = 'cancelled'; }, (ci) => { ci.checks[0].headSha = BASE; },
    (ci) => { ci.requiredChecks = []; }, (ci) => { ci.checks.push(clone(ci.checks[0])); },
    (ci) => { ci.checks.push({ name: 'additional-workflow', headSha: HEAD, status: 'completed', conclusion: 'failure' }); },
  ]) {
    const input = fixture(); change(input.observed.ci); expectReason(input, 'ci_incomplete_or_not_successful');
  }
});
test('missing authorization, wrong action, revoked or changed binding blocks', () => {
  for (const change of [
    (input) => { delete input.authorization; }, (input) => { input.authorization.action = 'deploy'; },
    (input) => { input.authorization.revoked = true; }, (input) => { input.authorization.headSha = BASE; },
    (input) => { input.authorization.sourceRef = ''; },
  ]) {
    const input = fixture(); change(input); expectReason(input, 'integration_authorization_missing_or_mismatched');
  }
});
test('revoked owner declaration cannot be recycled', () => {
  const input = unavailableFixture(); input.ownerConfirmation.revoked = true;
  expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
});
test('future, invalid and timezone-less dates are refused', () => {
  for (const date of ['bad-date', '2026-11-22T15:01:00Z', '2026-11-22T14:00:00', '2026-02-30T14:00:00Z', '2026-11-21T24:00:00Z']) {
    const input = unavailableFixture(); input.ownerConfirmation.observedAt = date;
    expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
  }
  for (const date of ['bad-date', '2026-02-30T15:00:00Z', '2026-11-21T24:00:00Z']) {
    const input = fixture(); input.now = date; expectReason(input, 'invalid_target_or_clock');
  }
  expectReason(null, 'invalid_target_or_clock');
});
test('technical evidence expires after fifteen minutes, owner evidence after at most twenty-four hours', () => {
  const input = fixture(); input.technical.observedAt = '2026-11-22T14:45:00Z';
  expectReason(input, 'technical_observation_missing_or_stale');
  const owner = unavailableFixture(); owner.ownerConfirmation.expiresAt = '2026-11-23T13:00:01Z';
  expectReason(owner, 'owner_confirmation_missing_invalid_or_expired');
});
test('unknown and partial technical results cannot silently become owner fallback', () => {
  const input = fixture(); input.technical.states.pop(); expectReason(input, 'technical_observation_incomplete');
  input.technical.status = 'unknown'; expectReason(input, 'technical_status_unknown');
});
test('contradictory unavailable result with an enabled service blocks', () => {
  const input = unavailableFixture(); input.technical.states = [{ serviceId: 'front', autoDeploy: 'enabled' }];
  expectReason(input, 'automatic_deploy_enabled');
});
test('normalized partial or GraphQL failures allow owner fallback without claiming an API result', () => {
  for (const reason of ['partial_response', 'graphql_error', 'schema_unknown', 'capability_not_exposed']) {
    const input = unavailableFixture(); input.technical.reason = reason;
    assert.equal(evaluateIntegrationCandidate(input).evidenceKind, 'owner');
    input.technical.states = [{ serviceId: 'front', autoDeploy: 'enabled' }];
    expectReason(input, 'automatic_deploy_enabled');
  }
});
test('a known rejected credential is not retried: its original failure and recent limitation inspection suffice', () => {
  const input = unavailableFixture(); input.technical.observedAt = '2026-11-21T12:00:00Z';
  assert.equal(evaluateIntegrationCandidate(input).outcome, 'candidate_satisfied');
  delete input.technical.originalFailureRef;
  expectReason(input, 'technical_limitation_not_documented');
});
test('limitation inspection expires independently and never proves Auto Deploy disabled', () => {
  const input = unavailableFixture(); input.technical.observedAt = '2026-11-21T12:00:00Z';
  input.technical.registeredAt = '2026-11-21T15:00:00Z';
  expectReason(input, 'technical_limitation_not_documented');
  input.technical.registeredAt = '2026-11-22T14:59:00Z'; delete input.ownerConfirmation;
  expectReason(input, 'owner_confirmation_missing_invalid_or_expired');
});
test('missing or duplicated services do not satisfy technical completeness', () => {
  const input = fixture(); input.technical.states[1] = clone(input.technical.states[0]);
  expectReason(input, 'technical_observation_incomplete');
  input.target.services = []; expectReason(input, 'invalid_target_or_clock');
});
test('evaluation is deterministic and leaves the input untouched', () => {
  const input = unavailableFixture(); const original = clone(input);
  assert.deepEqual(evaluateIntegrationCandidate(input), evaluateIntegrationCandidate(input));
  assert.deepEqual(input, original);
});

function snapshots() {
  const scope = fixture().target;
  const before = { complete: true, sourceRef: 'fixture:before', observedAt: '2026-11-22T14:58:00Z', scope: clone(scope),
    services: scope.services.map(({ id }) => ({ id, deploymentIds: [`existing-${id}`] })) };
  const after = clone(before); after.sourceRef = 'fixture:after'; after.observedAt = '2026-11-22T14:59:00Z';
  return { scope, before, after, now: NOW, mergedAt: '2026-11-22T14:58:30Z' };
}
test('same complete deployment history proves only absence in the observed interval', () => {
  assert.equal(compareDeploymentSnapshotsCandidate(snapshots()).reason, 'no_new_deployment_in_observed_history');
});
test('new deployment stops sequence for investigation, without automatic rollback or attribution', () => {
  const input = snapshots(); input.after.services[0].deploymentIds.push('new-deployment');
  const result = compareDeploymentSnapshotsCandidate(input);
  assert.equal(result.outcome, 'stop_for_investigation');
  assert.deepEqual(result.newDeployments, [{ serviceId: 'api', deploymentId: 'new-deployment' }]);
  assert.equal(result.rollback, undefined);
});
test('incomplete, mismatched or reverse-time monitoring remains inconclusive', () => {
  for (const change of [
    (input) => { input.after.complete = false; }, (input) => { input.after.services.pop(); },
    (input) => { input.after.scope.environmentId = 'other'; },
    (input) => { input.after.observedAt = '2026-11-22T14:57:00Z'; },
  ]) {
    const input = snapshots(); change(input);
    assert.equal(compareDeploymentSnapshotsCandidate(input).outcome, 'inconclusive');
  }
});
test('a disappearing baseline entry prevents a false no-deployment conclusion', () => {
  const input = snapshots(); input.after.services[0].deploymentIds = [];
  assert.equal(compareDeploymentSnapshotsCandidate(input).reason, 'deployment_history_lost_baseline_entries');
});
test('monitor snapshots must bracket the actual merge, not only each other', () => {
  for (const mergedAt of ['2026-11-22T14:57:00Z', '2026-11-22T14:59:30Z']) {
    const input = snapshots(); input.mergedAt = mergedAt;
    assert.equal(compareDeploymentSnapshotsCandidate(input).outcome, 'inconclusive');
  }
  assert.equal(compareDeploymentSnapshotsCandidate(null).outcome, 'inconclusive');
});
