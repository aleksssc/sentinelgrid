import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Compile pure modules in memory; no runtime aliases or server credentials.
function compile(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const moduleURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const policyURL = moduleURL(compile('../lib/agent/update-policy.ts'));
const { compareVersions, parseVersion, effectiveChannel, selectRelease } = await import(policyURL);
const reportSource = compile('../lib/agent/update-report.ts').replace('"./update-policy"', JSON.stringify(policyURL));
const { parseUpdateReport } = await import(moduleURL(reportSource));

const artifact = (version, channel = 'stable') => ({
  id: version, version, channel, platform: 'windows', architecture: 'amd64',
  storage_path: `${channel}/${version}/SentinelGridAgent.exe`, sha256: 'a'.repeat(64), size_bytes: 42, published_at: '2026-09-01T00:00:00Z',
});

test('semantic ordering, prerelease and arbitrary precision', () => {
  for (const [a, b] of [['0.1.9', '0.1.10'], ['1.0.0-alpha', '1.0.0-alpha.1'], ['1.0.0-alpha.1', '1.0.0-alpha.beta'], ['1.0.0-beta.2', '1.0.0-beta.11'], ['1.0.0-rc.1', '1.0.0'], ['1.0.0-99999999999999999', '1.0.0-100000000000000000']]) {
    assert.equal(compareVersions(a, b), -1);
    assert.equal(compareVersions(b, a), 1);
  }
  assert.equal(compareVersions('1.0.0+a', '1.0.0+b'), 0);
});
test('invalid semantic versions are rejected', () => {
  for (const value of ['', '1.2', '01.2.3', '1.2.3-01', '1.2.3-', 'v1.2.3', '1.2.3\n', null]) assert.throws(() => parseVersion(value));
});
test('same or older versions never update; newest wins regardless of publication order', () => {
  assert.equal(selectRelease([artifact('0.1.3'), artifact('0.1.2')], '0.1.3', 'stable'), undefined);
  assert.equal(selectRelease([artifact('0.1.9'), artifact('0.1.10')], '0.1.8', 'stable').version, '0.1.10');
});
test('signed beta 0.1.6 is selected for 0.1.5 without leaking into stable', () => {
  const beta = artifact('0.1.6', 'beta');
  assert.equal(selectRelease([beta], '0.1.5', 'beta'), beta);
  assert.equal(selectRelease([beta], '0.1.5', 'stable'), undefined);
  assert.equal(selectRelease([beta], '0.1.6', 'beta'), undefined);
});
test('organization channel selection and future override', () => {
  for (const channel of ['dev', 'beta', 'stable']) assert.equal(effectiveChannel(channel), channel);
  assert.equal(effectiveChannel('stable', 'beta'), 'beta');
  assert.throws(() => effectiveChannel('canary'));
  assert.equal(selectRelease([artifact('2.0.0', 'dev'), artifact('1.1.0')], '1.0.0', 'stable').version, '1.1.0');
  assert.throws(() => selectRelease([artifact('2.0.0-beta.1')], '1.0.0', 'stable'));
});
test('reject bad artifact metadata and traversal', () => {
  for (const patch of [{ sha256: 'bad' }, { size_bytes: 0 }, { size_bytes: 268435457 }, { storage_path: '../evil.exe' }]) {
    assert.throws(() => selectRelease([{ ...artifact('2.0.0'), ...patch }], '1.0.0', 'stable'));
  }
});
test('durable update reports preserve transaction and command identity', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const status of ['downloading', 'staged', 'succeeded', 'failed', 'rolled_back']) {
    const result = parseUpdateReport({ update_status: status, update_target_version: '0.1.6', transaction_id: id, command_id: id });
    assert.equal(result.transaction_id, id);
    assert.equal(result.command_id, id);
    assert.equal(result.update_status, status);
  }
  assert.equal(parseUpdateReport({ update_status: 'available', update_target_version: '0.1.6' }).transaction_id, undefined);
});
test('report metadata rejects credentials, arbitrary instructions, and invalid correlation', () => {
  for (const field of ['url', 'download_url', 'agent_token', 'path', 'command', 'arguments', 'service_name', 'organization_id']) {
    assert.throws(() => parseUpdateReport({ update_status: 'staged', [field]: 'untrusted' }));
  }
  for (const input of [null, [], {}, { update_status: 'executing' }, { update_status: 'failed', update_error: 'secret URL' },
    { update_status: 'staged', command_id: '11111111-1111-4111-8111-111111111111' },
    { update_status: 'staged', transaction_id: '../evil' },
    { update_status: 'staged', transaction_id: '11111111-1111-4111-8111-111111111111' }]) {
    assert.throws(() => parseUpdateReport(input));
  }
});
