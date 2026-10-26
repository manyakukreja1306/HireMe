import { createHash, randomUUID } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { canAccessPipeline, verifyGatewayContext } from './assertion.mjs';
import { mergeAnswers } from './policy.mjs';

const region = process.env.AWS_REGION || 'ap-south-1';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({ region });
const lambda = new LambdaClient({ region, maxAttempts: 2 });
const table = process.env.PIPELINE_TABLE || '';
const bucket = process.env.RESUME_BUCKET || '';
const orchestrator = process.env.PIPELINE_ORCHESTRATOR_FUNCTION || '';
const uploadLimit = Number(process.env.MAX_RESUME_BYTES || 2_000_000);

class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }
const keyFor = (id: string) => ({ PK: `APP#${id}`, SK: 'META' });
const appIdPattern = /^[a-zA-Z0-9_-]{1,200}$/;
const contentTypes: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};
const json = (statusCode: number, value: unknown) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(value) });
const now = () => new Date().toISOString();

function bodyText(event: any) {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : String(event.body);
}
function parseBody(raw: string) {
  if (Buffer.byteLength(raw) > 60_000) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'INVALID_JSON'); }
}
function identityContext(event: any, raw: string) {
  const headers = event.headers || {};
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const assertion = String(headers['x-ownership-assertion'] || '').split('.');
  if (assertion.length !== 3) throw new HttpError(403, 'FORBIDDEN');
  const context = verifyGatewayContext({
    secret: process.env.PIPELINE_ASSERTION_SECRET || '',
    timestamp: assertion[0],
    method: event.requestContext?.http?.method || '',
    path: event.rawPath || '',
    body: raw,
    encodedContext: assertion[1],
    signature: assertion[2],
    tokenSubject: claims.sub,
  });
  if (!context) throw new HttpError(403, 'FORBIDDEN');
  return context;
}
function requireContextPath(context: any, applicationId: string) {
  if (!appIdPattern.test(applicationId) || context.applicationId !== applicationId) throw new HttpError(404, 'APPLICATION_NOT_FOUND');
}
function assertContextMatchesRecord(context: any, record: any) {
  if (!canAccessPipeline(context, record)) throw new HttpError(404, 'APPLICATION_NOT_FOUND');
}
function requireCandidate(context: any) {
  if (context.role !== 'candidate' || context.sub !== context.candidateId) throw new HttpError(403, 'FORBIDDEN');
}
function requireOwner(context: any) {
  if (!((context.role === 'candidate' && context.sub === context.candidateId) || (context.role === 'recruiter' && context.sub === context.employerId))) throw new HttpError(403, 'FORBIDDEN');
}
async function loadRecord(applicationId: string) {
  if (!table) throw new HttpError(503, 'PIPELINE_NOT_CONFIGURED');
  const result = await ddb.send(new GetCommand({ TableName: table, Key: keyFor(applicationId), ConsistentRead: true }));
  if (!result.Item) throw new HttpError(404, 'APPLICATION_NOT_FOUND');
  return result.Item;
}
function validateJob(job: any) {
  if (!job || typeof job.title !== 'string' || !job.title.trim() || job.title.length > 300 || typeof job.description !== 'string' || !job.description.trim() || job.description.length > 40_000) throw new HttpError(400, 'INVALID_JOB');
  for (const field of ['requiredSkills', 'preferredSkills']) {
    if (job[field] !== undefined && (!Array.isArray(job[field]) || job[field].length > 80 || job[field].some((item: any) => typeof item !== 'string' || item.length > 120))) throw new HttpError(400, 'INVALID_JOB');
  }
  return { title: job.title.trim(), description: job.description, requiredSkills: job.requiredSkills || [], preferredSkills: job.preferredSkills || [] };
}
function validateCandidate(candidate: any) {
  if (!candidate || typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 200) throw new HttpError(400, 'INVALID_CANDIDATE');
  return { name: candidate.name.trim() };
}
async function invokeOrchestrator(input: Record<string, any>) {
  if (!orchestrator) throw new HttpError(503, 'PIPELINE_NOT_CONFIGURED');
  const response = await lambda.send(new InvokeCommand({ FunctionName: orchestrator, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(input)) }));
  if (response.StatusCode !== 202) throw new HttpError(503, 'PIPELINE_UNAVAILABLE');
}
async function consumeDailyRun(context:any) {
  const day=new Date().toISOString().slice(0,10);
  try {
    await ddb.send(new UpdateCommand({
      TableName:table,
      Key:{PK:`USER#${context.sub}`,SK:`RATE#${day}`},
      UpdateExpression:'SET expiresAt = :expires ADD #count :one',
      ConditionExpression:'attribute_not_exists(#count) OR #count < :limit',
      ExpressionAttributeNames:{'#count':'count'},
      ExpressionAttributeValues:{':expires':Math.floor(Date.now()/1000)+90*24*60*60,':one':1,':limit':5},
    }));
  } catch(error:any) {
    if(error?.name==='ConditionalCheckFailedException') throw new HttpError(429,'RATE_LIMITED');
    throw error;
  }
}
function principal(context: any) { return { sub: context.sub, role: context.role, candidateId: context.candidateId, employerId: context.employerId, jobId: context.jobId, applicationId: context.applicationId }; }
async function persistUploadBinding(context: any, body: any, resumeKey: string, extension: string) {
  const stamp = now();
  try {
    await ddb.send(new UpdateCommand({
      TableName: table, Key: keyFor(context.applicationId),
      UpdateExpression: 'SET applicationId = :app, candidateId = if_not_exists(candidateId, :candidate), candidateSub = if_not_exists(candidateSub, :candidate), employerId = if_not_exists(employerId, :employer), recruiterSub = if_not_exists(recruiterSub, :employer), jobId = if_not_exists(jobId, :job), resumeKey = :resume, resumeDigest = :digest, expectedResumeBytes = :bytes, resumeContentType = :contentType, resumeExtension = :extension, pipelineStatus = if_not_exists(pipelineStatus, :status), createdAt = if_not_exists(createdAt, :created), updatedAt = :updated, expiresAt = :expires, version = if_not_exists(version, :version)',
      ConditionExpression: 'attribute_not_exists(PK) OR (candidateSub = :candidate AND jobId = :job AND recruiterSub = :employer AND attribute_not_exists(resumeKey))',
      ExpressionAttributeValues: { ':app': context.applicationId, ':candidate': context.candidateId, ':employer': context.employerId, ':job': context.jobId, ':resume': resumeKey, ':digest': body.sha256, ':bytes': body.sizeBytes ?? body.size, ':contentType': body.mimeType || body.contentType, ':extension': extension, ':status': 'PENDING', ':created': stamp, ':updated': stamp, ':expires': Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, ':version': 1 },
    }));
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'RESUME_EXISTS');
    throw error;
  }
}
async function uploadResume(context: any, body: any) {
  requireCandidate(context);
  if (!bucket || !table) throw new HttpError(503, 'PIPELINE_NOT_CONFIGURED');
  if (!appIdPattern.test(context.candidateId) || !appIdPattern.test(context.applicationId) || !appIdPattern.test(context.jobId) || !appIdPattern.test(context.employerId)) throw new HttpError(400, 'INVALID_IDENTIFIER');
  const contentType = body.mimeType || body.contentType, size = body.sizeBytes ?? body.size;
  const extension = contentTypes[contentType];
  if (body.applicationId !== undefined && body.applicationId !== context.applicationId) throw new HttpError(400, 'INVALID_REQUEST');
  if (typeof body.fileName !== 'string' || body.fileName.length > 255 || !body.fileName.toLowerCase().endsWith(`.${extension || ''}`)) throw new HttpError(400, 'INVALID_REQUEST');
  if (!extension) throw new HttpError(415, 'UNSUPPORTED_TYPE');
  if (!Number.isInteger(size) || size < 1 || size > uploadLimit) throw new HttpError(413, 'FILE_TOO_LARGE');
  if (typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)) throw new HttpError(400, 'INVALID_RESUME');
  const resumeKey = `resumes/${context.candidateId}/${context.applicationId}.${extension}`;
  await persistUploadBinding(context, body, resumeKey, extension);
  const command = new PutObjectCommand({
    Bucket: bucket, Key: resumeKey, ContentType: contentType, ContentLength: size,
    Metadata: { 'resume-sha256': body.sha256, 'application-id': context.applicationId }, ServerSideEncryption: 'AES256',
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  return json(200, { resumeKey, uploadUrl, requiredHeaders: { 'content-type': contentType, 'x-amz-meta-resume-sha256': body.sha256, 'x-amz-meta-application-id': context.applicationId, 'x-amz-server-side-encryption': 'AES256' }, expiresInSeconds: 300 });
}
async function startPipeline(context: any, applicationId: string, body: any) {
  requireOwner(context); requireContextPath(context, applicationId);
  const record = await loadRecord(applicationId); assertContextMatchesRecord(context, record);
  let job = validateJob(body.job);
  const candidate = validateCandidate(body.candidate);
  if ((body.resumeKey && body.resumeKey !== record.resumeKey) || body.resumeDigest !== record.resumeDigest) throw new HttpError(400, 'RESUME_MISMATCH');
  if (record.jobSnapshot) job=validateJob(record.jobSnapshot);
  else {
    const snapshotHash=createHash('sha256').update(JSON.stringify({jobId:record.jobId,...job,threshold:Number(process.env.MATCH_THRESHOLD||70)})).digest('hex');
    try {
      await ddb.send(new UpdateCommand({TableName:table,Key:keyFor(applicationId),UpdateExpression:'SET jobSnapshot=:snapshot,snapshotHash=:hash,threshold=:threshold,updatedAt=:updated ADD version :one',ConditionExpression:'candidateSub=:candidate AND version=:version',ExpressionAttributeValues:{':snapshot':job,':hash':snapshotHash,':threshold':Number(process.env.MATCH_THRESHOLD||70),':updated':now(),':one':1,':candidate':context.candidateId,':version':record.version}}));
    } catch(error:any) {
      if(error?.name==='ConditionalCheckFailedException') throw new HttpError(409,'RUN_IN_PROGRESS');
      throw error;
    }
  }
  const object = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: record.resumeKey }));
  if (object.ContentLength !== record.expectedResumeBytes || object.ContentType !== record.resumeContentType || object.Metadata?.['resume-sha256'] !== record.resumeDigest || object.Metadata?.['application-id'] !== applicationId) throw new HttpError(400, 'RESUME_UPLOAD_INVALID');
  await consumeDailyRun(context);
  await invokeOrchestrator({ applicationId, candidateId: context.candidateId, jobId: context.jobId, employerId: context.employerId, resumeKey: record.resumeKey, resumeDigest: record.resumeDigest, candidate, job, principal: principal(context) });
  return json(202, { status: 'PROCESSING' });
}
async function readPipeline(context: any, applicationId: string) {
  requireContextPath(context, applicationId);
  const record = await loadRecord(applicationId); assertContextMatchesRecord(context, record);
  const result = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `APP#${applicationId}` }, ConsistentRead: true }));
  const view: any = { ...record, pipelineData: { resumeAnalysis: record.resumeAnalysis, match: record.match, interview: record.interview }, completedStages: (result.Items || []).filter((item: any) => item.SK?.startsWith('STAGE#')).map((item: any) => item.SK), auditSummary:(result.Items||[]).filter((item:any)=>item.SK?.startsWith('AUDIT#')).map((item:any)=>({agent:item.agent,promptVersion:item.promptVersion,inputHash:item.inputHash,outputHash:item.outputHash,durationMs:item.durationMs,result:item.result})) };
  if (context.role === 'recruiter' && record.resumeKey) {
    view.resumeDownloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: record.resumeKey, ResponseContentDisposition: 'attachment' }), { expiresIn: 300 });
  }
  view.humanReviewRequired = record.match?.matchScore == null || Boolean(record.resumeAnalysis?.extractionWarnings?.length);
  for (const key of ['PK', 'SK', 'candidateId', 'employerId', 'jobId', 'resumeKey', 'resumeDigest', 'expectedResumeBytes', 'resumeContentType', 'resumeExtension', 'inputHash', 'interviewAnswerHash', 'leaseUntil', 'leaseOwner']) delete view[key];
  if (context.role !== 'recruiter') {
    const safeEvaluations = (record.interview?.evaluations || []).map((evaluation: any) => ({ questionId: evaluation.questionId, feedback: evaluation.feedback }));
    return json(200, {
      applicationId,
      pipelineStatus: record.pipelineStatus,
      resumeWarnings: record.resumeAnalysis?.extractionWarnings || [],
      interview: record.interview ? {
        questions: record.interview.questions || [],
        evaluations: safeEvaluations,
        strengths: record.interview.interviewScore == null ? [] : record.interview.strengths || [],
        improvementAreas: record.interview.interviewScore == null ? [] : record.interview.improvementAreas || [],
      } : null,
      interviewAnswers: record.interviewAnswers || [],
      candidateFeedback: record.interview?.interviewScore == null ? null : record.interview?.rationale || null,
      humanReviewRequired: record.match?.matchScore == null || Boolean(record.resumeAnalysis?.extractionWarnings?.length),
    });
  }
  return json(200, view);
}
async function generateInterview(context: any, applicationId: string, body: any) {
  requireOwner(context); requireContextPath(context, applicationId);
  const record = await loadRecord(applicationId); assertContextMatchesRecord(context, record);
  if (typeof record.resumeKey !== 'string' || typeof record.resumeDigest !== 'string') throw new HttpError(409, 'ASSESSMENT_NOT_STARTED');
  const object = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: record.resumeKey }));
  if (object.ContentLength !== record.expectedResumeBytes || object.ContentType !== record.resumeContentType || object.Metadata?.['resume-sha256'] !== record.resumeDigest || object.Metadata?.['application-id'] !== applicationId) throw new HttpError(400, 'RESUME_UPLOAD_INVALID');
  await invokeOrchestrator({ applicationId, candidateId: context.candidateId, jobId: context.jobId, employerId: context.employerId, resumeKey: record.resumeKey, resumeDigest: record.resumeDigest, candidate: validateCandidate(body.candidate), job: validateJob(record.jobSnapshot || body.job), principal: principal(context) });
  return json(202, { status: 'PROCESSING' });
}
async function submitAnswers(context: any, applicationId: string, body: any) {
  requireCandidate(context); requireContextPath(context, applicationId);
  const record = await loadRecord(applicationId); assertContextMatchesRecord(context, record);
  const submitted = Array.isArray(body.answers) ? body.answers : typeof body.questionId === 'string' && typeof body.answerText === 'string' ? [{ questionId: body.questionId, answer: body.answerText }] : null;
  if (!Array.isArray(submitted) || submitted.length > 5) throw new HttpError(400, 'INVALID_ANSWERS');
  const merged = mergeAnswers(record.interview?.questions || [], record.interviewAnswers || [], submitted);
  if (!merged) throw new HttpError(400, 'INVALID_ANSWERS');
  if (!merged.complete) {
    await ddb.send(new UpdateCommand({ TableName: table, Key: keyFor(applicationId), UpdateExpression: 'SET interviewAnswers = :answers, pipelineStatus = :status, stage = :stage, updatedAt = :updated ADD version :one', ConditionExpression: 'candidateSub = :candidate AND version = :previousVersion', ExpressionAttributeValues: { ':answers': merged.answers, ':status': 'PROCESSING', ':stage': 'INTERVIEW_PENDING', ':updated': now(), ':candidate': context.candidateId, ':previousVersion': record.version, ':one': 1 } }));
    return json(200, { status: 'PROCESSING', complete: false });
  }
  if (record.pipelineStatus === 'COMPLETE') throw new HttpError(409, 'INTERVIEW_ALREADY_COMPLETE');
  const job = validateJob(record.jobSnapshot || body.job), candidate = validateCandidate(body.candidate);
  await ddb.send(new UpdateCommand({ TableName: table, Key: keyFor(applicationId), UpdateExpression: 'SET interviewAnswers = :answers, pipelineStatus = :status, stage = :stage, updatedAt = :updated ADD version :one', ConditionExpression: 'candidateSub = :candidate AND version = :previousVersion', ExpressionAttributeValues: { ':answers': merged.answers, ':status': 'PROCESSING', ':stage': 'INTERVIEW_EVALUATING', ':updated': now(), ':candidate': context.candidateId, ':previousVersion': record.version, ':one': 1 } }));
  await invokeOrchestrator({ applicationId, candidateId: context.candidateId, jobId: context.jobId, employerId: context.employerId, resumeKey: record.resumeKey, resumeDigest: record.resumeDigest, candidate, job, answers: merged.answers, principal: principal(context) });
  return json(202, { status: 'PROCESSING', complete: true });
}
export async function publicApiHandler(event: any) {
  let raw = '';
  const requestId = event?.requestContext?.requestId || randomUUID();
  const withRequestId = (response:any) => ({ ...response, body: JSON.stringify({ ...JSON.parse(response.body || '{}'), requestId }) });
  try {
    if (!event?.requestContext?.authorizer?.jwt?.claims?.sub) throw new HttpError(401, 'UNAUTHORIZED');
    raw = bodyText(event);
    const context = identityContext(event, raw);
    const body = parseBody(raw);
    const route = event.routeKey || `${event.requestContext.http.method} ${event.rawPath}`;
    if (route === 'POST /uploads/resume') return withRequestId(await uploadResume(context, body));
    const applicationId = event.pathParameters?.applicationId || context.applicationId;
    if (route === 'POST /pipeline/{applicationId}/run') return withRequestId(await startPipeline(context, applicationId, body));
    if (route === 'GET /pipeline/{applicationId}') return withRequestId(await readPipeline(context, applicationId));
    if (route === 'POST /pipeline/{applicationId}/questions') return withRequestId(await generateInterview(context, applicationId, body));
    if (route === 'POST /pipeline/{applicationId}/answers') return withRequestId(await submitAnswers(context, applicationId, body));
    throw new HttpError(404, 'ROUTE_NOT_FOUND');
  } catch (error: any) {
    if (error instanceof HttpError) return json(error.status, { error: error.code, requestId });
    console.error('Pipeline API request failed', error?.name || 'Error');
    return json(500, { error: 'INTERNAL_ERROR', requestId });
  }
}
