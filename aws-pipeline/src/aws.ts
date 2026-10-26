import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION || 'ap-south-1';
export const lambda = new LambdaClient({ region, maxAttempts: 2 });
export const s3 = new S3Client({ region, maxAttempts: 2 });
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
export const table = process.env.PIPELINE_TABLE || '';
export const bucket = process.env.RESUME_BUCKET || '';
const rawThreshold=Number(process.env.MATCH_THRESHOLD ?? 70);
export const threshold = Number.isFinite(rawThreshold) ? Math.max(0,Math.min(100,rawThreshold)) : 70;

export async function invokeAgent(name: string, payload: unknown) {
  const functionName = process.env[`${name.toUpperCase()}_AGENT_FUNCTION`];
  if (!functionName) throw new Error(`${name} agent Lambda is not configured`);
  const result = await lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(payload)) }));
  if (result.FunctionError) {
    const error = new Error(`${name} agent failed`);
    error.name = `${name}AgentFailed`;
    throw error;
  }
  const parsed = JSON.parse(new TextDecoder().decode(result.Payload));
  if (parsed.errorMessage || parsed.errorType) {
    const names: Record<string, string> = { AccessDeniedException: 'AWSAccessDenied', ThrottlingException: 'AWSServiceThrottled' };
    const error = new Error(`${name} agent failed`);
    error.name = names[parsed.errorType] || `${name}AgentFailed`;
    throw error;
  }
  return parsed;
}
export async function getResume(key: string) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const format = key.toLowerCase().endsWith('.pdf') ? 'pdf' : key.toLowerCase().endsWith('.docx') ? 'docx' : key.toLowerCase().endsWith('.txt') ? 'txt' : null;
  if (!format || !obj.Body) throw new Error('Resume must be a readable PDF, DOCX, or TXT object');
  const chunks: Uint8Array[] = [];
  for await (const chunk of obj.Body as any) chunks.push(chunk);
  const data = Buffer.concat(chunks);
  if (data.length > 2_000_000) throw new Error('Resume exceeds the 2 MB analysis limit');
  if (format === 'pdf' && data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Resume does not contain PDF bytes');
  if (format === 'docx' && !(data[0] === 0x50 && data[1] === 0x4b)) throw new Error('Resume does not contain DOCX bytes');
  if (format === 'txt' && data.includes(0)) throw new Error('Resume contains binary data');
  return { name: key.split('/').pop() || 'resume', data, format } as const;
}
export const appKey = (id: string) => ({ PK: `APP#${id}`, SK: 'META' });
export async function readRecord(id: string) { const r = await ddb.send(new GetCommand({ TableName: table, Key: appKey(id), ConsistentRead: true })); return r.Item; }
export async function queryApplicationStages(id: string) { const r = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `APP#${id}` }, ConsistentRead: true })); return r.Items || []; }
export async function saveRecord(record: Record<string, any>) {
  const expectedVersion=Number(record.version||0), nextVersion=expectedVersion+1;
  const item={ ...record, version:nextVersion, expiresAt:record.expiresAt||Math.floor(Date.now()/1000)+90*24*60*60, ...appKey(record.applicationId) };
  if (Buffer.byteLength(JSON.stringify(item)) > 350_000) throw new Error('Pipeline item exceeds the safe DynamoDB storage limit');
  await ddb.send(new PutCommand({ TableName:table, Item:item, ...(expectedVersion ? {ConditionExpression:'version = :expected',ExpressionAttributeValues:{':expected':expectedVersion}} : {ConditionExpression:'attribute_not_exists(PK)'}) }));
  record.version=nextVersion;
}
export async function updateStatus(id: string, status: string, errorCode?: string) {
  const failed=Boolean(errorCode);
  await ddb.send(new UpdateCommand({ TableName: table, Key: appKey(id), UpdateExpression: failed ? 'SET pipelineStatus=:s,updatedAt=:t,errorCode=:e' : 'SET pipelineStatus=:s,updatedAt=:t', ExpressionAttributeValues: failed ? { ':s':status, ':t':new Date().toISOString(), ':e':errorCode } : { ':s':status, ':t':new Date().toISOString() } }));
}
