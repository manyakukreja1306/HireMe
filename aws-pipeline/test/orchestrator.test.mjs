import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { signGatewayContext } from '../src/assertion.mjs';

process.env.PIPELINE_TABLE = 'hirely-unit-test';
process.env.AWS_REGION = 'ap-south-1';
process.env.MATCH_THRESHOLD = '70';
process.env.RESUME_AGENT_FUNCTION = 'test-resume';
process.env.MATCHING_AGENT_FUNCTION = 'test-matching';
process.env.INTERVIEW_AGENT_FUNCTION = 'test-interview';
process.env.HEADHUNTER_AGENT_FUNCTION = 'test-headhunter';

const [{ ddb, lambda }, { orchestratorHandler, publicApiHandler }] = await Promise.all([
  import('../src/aws.ts'), import('../src/handlers.ts'),
]);

const resume = {
  skills: ['TypeScript'], experience: [], education: [], certifications: [], projects: [], summary: 'Backend experience', extractionWarnings: [], charCount: 900,
};
const questions = [{ id: 'q1', question: 'Describe a relevant project', skill: 'TypeScript' }];
const baseInput = {
  applicationId: 'app-1', candidateId: 'cand-1', employerId: 'rec-1', jobId: 'job-1',
  resumeKey: 'resumes/cand-1/app-1.pdf', resumeDigest: 'a'.repeat(64),
  candidate: { name: 'Candidate' }, job: { title: 'Engineer', description: 'TypeScript backend engineer', requiredSkills: ['TypeScript'], preferredSkills: [] },
  principal: { sub: 'cand-1', role: 'candidate', applicationId: 'app-1', candidateId: 'cand-1', employerId: 'rec-1', jobId: 'job-1' },
};

function setup(t, { matchScore = 80, failAgent = '', includeEvaluation = true } = {}) {
  let record = {
    PK: 'APP#app-1', SK: 'META', applicationId: 'app-1', candidateId: 'cand-1', employerId: 'rec-1', jobId: 'job-1',
    resumeKey: baseInput.resumeKey, resumeDigest: baseInput.resumeDigest, pipelineStatus: 'PENDING',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const invoked = [];
  t.mock.method(ddb, 'send', async command => {
    const name = command.constructor.name;
    if (name === 'GetCommand') return { Item: { ...record } };
    if (name === 'PutCommand') { record = { ...command.input.Item }; return {}; }
    if (name === 'UpdateCommand') {
      if (command.input.ExpressionAttributeValues?.[':s']) record = { ...record, pipelineStatus: command.input.ExpressionAttributeValues[':s'], errorCode: command.input.ExpressionAttributeValues[':e'] };
      return {};
    }
    if (name === 'DeleteCommand') return {};
    throw new Error(`Unexpected DynamoDB command ${name}`);
  });
  t.mock.method(lambda, 'send', async command => {
    const name = command.input.FunctionName;
    const payload = JSON.parse(Buffer.from(command.input.Payload).toString('utf8'));
    invoked.push({ name, payload });
    if (name === failAgent) return { FunctionError: 'Unhandled', Payload: Buffer.from('{}') };
    let result;
    if (name === 'test-resume') result = resume;
    if (name === 'test-matching') result = {
      matchScore, noCriteria: false, requiredSkills: ['TypeScript'], preferredSkills: [], matchedSkills: matchScore >= 70 ? ['TypeScript'] : [],
      missingSkills: matchScore >= 70 ? [] : ['TypeScript'], partialMatches: [], evidence: ['Resume lists TypeScript'], rationale: 'Job criteria were compared with resume evidence.',
    };
    if (name === 'test-interview' && payload.action === 'generate') result = { questions, evaluations: [], interviewScore: null, strengths: [], improvementAreas: [], rationale: 'Questions are ready for candidate answers.' };
    if (name === 'test-interview' && payload.action === 'evaluate') result = includeEvaluation
      ? { questions, evaluations: [{ questionId: 'q1', score: 82, feedback: 'Clear example.', evidence: ['I built a service.'] }], interviewScore: 82, strengths: ['Clear example'], improvementAreas: [], rationale: 'Answer included relevant evidence.' }
      : { questions, evaluations: [], interviewScore: null, strengths: [], improvementAreas: [], rationale: 'No valid evaluation.' };
    if (name === 'test-headhunter') result = { draft: 'Hello Candidate, your TypeScript experience may fit this Engineer role.' };
    if (!result) throw new Error(`Unexpected Lambda ${name}`);
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify(result)) };
  });
  return { invoked, current: () => record };
}

test('below threshold still creates interview questions but does not draft outreach', async t => {
  const state = setup(t, { matchScore: 42 });
  const result = await orchestratorHandler(baseInput);
  assert.equal(result.pipelineStatus, 'PROCESSING');
  assert.equal(result.stage, 'INTERVIEW_PENDING');
  assert.equal(state.invoked.some(call => call.name === 'test-interview'), true);
  assert.equal(state.invoked.some(call => call.name === 'test-headhunter'), false);
});

test('above threshold creates pending questions without evaluating or scoring answers', async t => {
  const state = setup(t);
  const result = await orchestratorHandler(baseInput);
  assert.equal(result.pipelineStatus, 'PROCESSING');
  assert.equal(result.stage, 'INTERVIEW_PENDING');
  assert.equal(result.interviewScore, null);
  assert.equal(result.interview.interviewScore, null);
  assert.equal(state.invoked.some(call => call.name === 'test-headhunter'), false);
});

test('real answers are evaluated before completion and any outreach draft', async t => {
  const state = setup(t);
  const first = await orchestratorHandler(baseInput);
  const second = await orchestratorHandler({ ...baseInput, answers: [{ questionId: 'q1', answer: 'I built a TypeScript service.' }] });
  assert.equal(first.pipelineStatus, 'PROCESSING');
  assert.equal(second.pipelineStatus, 'COMPLETE');
  assert.equal(second.interviewScore, 82);
  assert.equal('recommendation' in second, false);
  assert.match(second.outreachDraft, /Hello Candidate/);
  assert.equal(state.invoked.filter(call => call.name === 'test-headhunter').length, 1);
});

test('invalid answer sets cannot mark the interview complete', async t => {
  const state = setup(t);
  await orchestratorHandler(baseInput);
  const result = await orchestratorHandler({ ...baseInput, answers: [{ questionId: 'unknown', answer: 'A response' }] });
  assert.equal(result.status, 'FAILED');
  assert.equal(state.invoked.filter(call => call.name === 'test-interview' && call.payload.action === 'evaluate').length, 0);
  assert.notEqual(state.current().pipelineStatus, 'INTERVIEW_EVALUATED');
});

test('identical requests reuse completed agent stages', async t => {
  const state = setup(t);
  await orchestratorHandler(baseInput);
  await orchestratorHandler(baseInput);
  assert.equal(state.invoked.filter(call => call.name === 'test-resume').length, 1);
  assert.equal(state.invoked.filter(call => call.name === 'test-matching').length, 1);
  assert.equal(state.invoked.filter(call => call.name === 'test-interview').length, 1);
});

test('failed agent invocation leaves a safe recoverable failure state', async t => {
  const state = setup(t, { failAgent: 'test-matching' });
  const result = await orchestratorHandler(baseInput);
  assert.equal(result.status, 'FAILED');
  assert.equal(state.current().pipelineStatus, 'FAILED');
  assert.equal(typeof state.current().errorCode, 'string');
  assert.equal(JSON.stringify(result).includes('resumeKey'), false);
});

test('caller ownership is checked before orchestration', async t => {
  const state = setup(t);
  const result = await orchestratorHandler({ ...baseInput, principal: { ...baseInput.principal, sub: 'another-user' } });
  assert.equal(result.status, 'FAILED');
  assert.equal(state.invoked.length, 0);
});

test('API handler rejects requests without verified Gateway JWT claims', async () => {
  const response = await publicApiHandler({ requestContext:{ http:{ method:'GET' } }, rawPath:'/pipeline/app-1', headers:{} });
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error, 'UNAUTHORIZED');
});

test('API handler rejects a body changed after the Vercel ownership assertion was signed', async () => {
  const secret = 'test-secret-for-gateway-request-signatures-32';
  process.env.PIPELINE_ASSERTION_SECRET = secret;
  const context = { sub:'cand-1', role:'candidate', applicationId:'app-1', candidateId:'cand-1', employerId:'rec-1', jobId:'job-1' };
  const timestamp = String(Date.now());
  const signedBody = JSON.stringify({ contentType:'text/plain', size:3, sha256:'a'.repeat(64) });
  const signed = signGatewayContext(secret, { timestamp, method:'POST', path:'/uploads/resume', body:signedBody, context });
  const response = await publicApiHandler({
    requestContext:{ http:{ method:'POST' }, authorizer:{ jwt:{ claims:{ sub:'cand-1' } } } },
    routeKey:'POST /uploads/resume', rawPath:'/uploads/resume', body:JSON.stringify({ contentType:'text/plain', size:4, sha256:'a'.repeat(64) }),
  headers:{ 'x-ownership-assertion':signed.assertion },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, 'FORBIDDEN');
});

test('SAM template protects routes and keeps document extraction in Lambda', async () => {
  const template = await readFile(new URL('../template.yaml', import.meta.url), 'utf8');
  assert.match(template, /DefaultAuthorizer:\s*ClerkJwtAuthorizer/);
  assert.match(template, /issuer:\s*!Ref ClerkIssuer/);
  assert.match(template, /audience:\s*\[!Ref ClerkAudience\]/);
  assert.match(template, /AllowOrigins:\s*\[!Ref ProductionOrigin\]/);
  assert.match(template, /DefaultRouteSettings:/);
  assert.match(template, /Type: AWS::Serverless::Function/);
  assert.doesNotMatch(template, /AWS::EC2::|DOCUMENT_SERVICE|DocumentProcessor/);
  for (const path of ['/uploads/resume', '/pipeline/{applicationId}/run', '/pipeline/{applicationId}', '/pipeline/{applicationId}/questions', '/pipeline/{applicationId}/answers']) {
    assert.ok(template.includes(`Path: ${path}`) || template.includes(`Path: '${path}'`), `Missing protected route ${path}`);
  }
});
