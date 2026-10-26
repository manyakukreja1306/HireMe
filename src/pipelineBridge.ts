import { createClerkClient, verifyToken } from '@clerk/backend';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });
import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { canAccessApplication } from './pipelineAccess.mjs';
import { signGatewayContext } from '../aws-pipeline/src/assertion.mjs';
import { createHash } from 'node:crypto';
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;
const clerk = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null;
const MAX_RESUME_BYTES=2_000_000;

export async function identity(req: Request) {
  if (!process.env.CLERK_SECRET_KEY) throw new Error('not-configured');
  const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) throw new Error('unauthorized');
  const authorizedParties=(process.env.CLERK_AUTHORIZED_PARTIES||'http://localhost:3000').split(',').map(x=>x.trim()).filter(Boolean);
  let claims:any;
  try { claims=await verifyToken(bearer, { secretKey: process.env.CLERK_SECRET_KEY, authorizedParties }); }
  catch { throw new Error('unauthorized'); }
  if (typeof claims.sub !== 'string') throw new Error('unauthorized');
  return claims.sub;
}
async function getProfile(userId:string):Promise<any> {
  if (!supabase) throw new Error('not-configured');
  const { data }=await supabase.from('profiles').select('*').eq('uid',userId).maybeSingle();
  if(!data) throw new Error('forbidden');
  return data;
}
async function getRole(userId:string) {
  if (!clerk) throw new Error('not-configured');
  const user = await clerk.users.getUser(userId);
  const role = user.publicMetadata?.role;
  if (role !== 'candidate' && role !== 'recruiter') throw new Error('forbidden');
  return role;
}
export async function enrollRole(req:Request,res:Response) {
  try {
    const userId=await identity(req), requested=req.body?.role;
    if (requested !== 'candidate' && requested !== 'recruiter') return res.status(400).json({error:'Choose a valid account role'});
    if (!clerk) throw new Error('not-configured');
    const user=await clerk.users.getUser(userId), current=user.publicMetadata?.role;
    if (current === 'candidate' || current === 'recruiter') return res.json({role:current});
    if (current !== undefined && current !== null) throw new Error('forbidden');
    const updated=await clerk.users.updateUserMetadata(userId,{publicMetadata:{role:requested}});
    return res.json({role:updated.publicMetadata?.role});
  } catch(error:any) {
    if (error?.message==='forbidden') return res.status(403).json({error:'Account role is invalid'});
    return fail(res,error);
  }
}
function fail(res: Response, error: any) {
  if (error?.message === 'unauthorized') return res.status(401).json({ error: 'Authentication required' });
  if (error?.message === 'not-configured') return res.status(503).json({ error: 'Pipeline server configuration is incomplete' });
  console.error('Pipeline request failed', error?.name || 'Error');
  return res.status(500).json({ error: 'Pipeline request failed' });
}
async function getAuthorizedContext(applicationId: string, userId: string) {
  if (!supabase) throw new Error('not-configured');
  const { data: application, error } = await supabase.from('applications').select('*').eq('id', applicationId).maybeSingle();
  if (error || !application) throw new Error('not-found');
  const { data: profileData } = await supabase.from('profiles').select('uid,name').eq('uid', userId).maybeSingle();
  if (!profileData) throw new Error('forbidden');
  const profile:any = profileData;
  profile.role = await getRole(userId);
  const { data: job } = await supabase.from('jobs').select('*').eq('id', application.job_id).maybeSingle();
  if (!job) throw new Error('not-found');
  if (!canAccessApplication(profile.role,userId,application.candidate_id,job.employer_id)) throw new Error('forbidden');
  return { application, profile, job };
}
function gatewayUrl(path: string) {
  const base = process.env.PIPELINE_API_URL;
  if (!base) throw new Error('not-configured');
  const url = new URL(path.replace(/^\//, ''), `${base.replace(/\/+$/, '')}/`);
  return url;
}
async function callGateway(req: Request, path: string, method: string, body: Record<string, any> | null, identityContext: Record<string, string>) {
  const url = gatewayUrl(path);
  const rawBody = body === null ? '' : JSON.stringify(body);
  const timestamp = String(Date.now());
  const signed = signGatewayContext(process.env.PIPELINE_ASSERTION_SECRET || '', {
    timestamp, method, path: url.pathname, body: rawBody, context: identityContext,
  });
  const token = req.header('authorization') || '';
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: token,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
      'X-Ownership-Assertion': signed.assertion,
    },
    ...(body === null ? {} : { body: rawBody }),
    signal: AbortSignal.timeout(30_000),
  });
  const responseText = await response.text();
  let data: any;
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { throw new Error('gateway-invalid-response'); }
  if (!response.ok) {
    const error: any = new Error('gateway-request-failed');
    error.status = response.status;
    error.code = typeof data?.error === 'string' ? data.error : 'PIPELINE_REQUEST_FAILED';
    throw error;
  }
  return data;
}
function gatewayFailure(res: Response, error: any) {
  if (error?.message === 'not-configured') return res.status(503).json({ error: 'Pipeline server configuration is incomplete' });
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    const messages: Record<string, string> = {
      APPLICATION_NOT_FOUND: 'Application not found', INVALID_RESUME: 'Resume file type, size, or content is invalid',
      RESUME_UPLOAD_INVALID: 'Resume upload could not be verified',
      INVALID_ANSWERS: 'Provide valid answers for the saved interview questions', INTERVIEW_ALREADY_COMPLETE: 'Interview evaluation is already complete',
    };
    return res.status(error.status).json({ error: messages[error.code] || 'Pipeline request could not be completed' });
  }
  return fail(res, error);
}

export async function startPipeline(req: Request, res: Response) {
  try {
    const userId = await identity(req);
    const applicationId = String(req.body?.applicationId || '');
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(applicationId)) return res.status(400).json({ error: 'Valid applicationId is required' });
    const { application, profile, job } = await getAuthorizedContext(applicationId, userId);
    if (profile.role !== 'candidate') return res.status(403).json({ error: 'Only the applicant can start this assessment' });
    if (typeof job.title !== 'string' || !job.title.trim() || job.title.length > 300) return res.status(400).json({ error: 'The selected job has an invalid title' });
    if (typeof job.description !== 'string' || !job.description.trim()) return res.status(400).json({ error: 'The selected job needs a description before it can be assessed' });
    if (job.description.length > 40000) return res.status(400).json({ error: 'The selected job description exceeds the 40 KB assessment limit' });
    const candidateName = application.candidate_name || profile.name;
    if (typeof candidateName !== 'string' || !candidateName.trim()) return res.status(400).json({ error: 'The candidate profile needs a name before assessment can start' });
    const resumeDataUrl = req.body?.resumeDataUrl;
    if (typeof resumeDataUrl !== 'string' || resumeDataUrl.length > 2_800_000) return res.status(400).json({ error: 'A valid resume file is required' });
    const match = resumeDataUrl.match(/^data:(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: 'Resume must be a PDF, DOCX, or text file' });
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.toString('base64') !== match[2]) return res.status(400).json({ error: 'Resume encoding is invalid' });
    if (!bytes.length || bytes.length > MAX_RESUME_BYTES) return res.status(413).json({ error: 'Resume exceeds the 2 MB assessment limit' });
    if(match[1]==='application/pdf'&&!bytes.subarray(0,5).toString('ascii').startsWith('%PDF-')) return res.status(400).json({error:'Resume content is not a valid PDF'});
    if(match[1]==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'&&(bytes[0]!==0x50||bytes[1]!==0x4b)) return res.status(400).json({error:'Resume content is not a valid DOCX file'});
    if(match[1]==='text/plain'&&bytes.includes(0)) return res.status(400).json({error:'Resume text file contains unsupported binary content'});
    const contentType = match[1];
    const resumeDigest = createHash('sha256').update(bytes).digest('hex');
    const identityContext = { sub:userId, role:'candidate', applicationId, candidateId:userId, employerId:job.employer_id, jobId:job.id };
    const extension = contentType === 'application/pdf' ? 'pdf' : contentType === 'text/plain' ? 'txt' : 'docx';
    let resumeKey:string|undefined;
    try {
      const signed = await callGateway(req, '/uploads/resume', 'POST', { applicationId, fileName:`resume.${extension}`, mimeType:contentType, sizeBytes:bytes.length, sha256:resumeDigest }, identityContext);
      const upload = await fetch(signed.uploadUrl, { method:'PUT', headers:signed.requiredHeaders, body:bytes, signal:AbortSignal.timeout(30_000) });
      if (!upload.ok) throw new Error('resume-upload-failed');
      resumeKey=signed.resumeKey;
    } catch(error:any) {
      if (error?.code !== 'RESUME_EXISTS') throw error;
    }
    const result = await callGateway(req, `/pipeline/${encodeURIComponent(applicationId)}/run`, 'POST', {
      ...(resumeKey ? {resumeKey} : {}), resumeDigest,
      candidate:{ name:candidateName.trim() },
      job:{ title:job.title.trim(), description:job.description, requiredSkills:Array.isArray(job.required_skills)?job.required_skills:[], preferredSkills:Array.isArray(job.preferred_skills)?job.preferred_skills:[] },
    }, identityContext);
    return res.status(202).json(result);
  } catch (error: any) {
    if (error?.message === 'forbidden') return res.status(403).json({ error: 'Not authorized for this application' });
    if (error?.message === 'not-found') return res.status(404).json({ error: 'Application or job not found' });
    return gatewayFailure(res, error);
  }
}

export async function getPipeline(req: Request, res: Response) {
  try {
    const userId = await identity(req);
    const applicationId = String(req.params.applicationId || '');
    const { profile,application,job } = await getAuthorizedContext(applicationId, userId);
    const record = await callGateway(req, `/pipeline/${encodeURIComponent(applicationId)}`, 'GET', null, {
      sub:userId, role:profile.role, applicationId, candidateId:application.candidate_id, employerId:job.employer_id, jobId:job.id,
    });
    return res.json(record);
  } catch (error: any) {
    if (error?.message === 'forbidden') return res.status(403).json({ error: 'Not authorized for this application' });
    if (error?.message === 'not-found') return res.status(404).json({ error: 'Application or job not found' });
    return gatewayFailure(res, error);
  }
}

export async function submitPipelineAnswers(req: Request, res: Response) {
  try {
    const userId = await identity(req);
    const applicationId = String(req.body?.applicationId || '');
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(applicationId)) return res.status(400).json({ error:'Valid applicationId is required' });
    const { application, profile, job } = await getAuthorizedContext(applicationId, userId);
    if (profile.role !== 'candidate' || application.candidate_id !== userId) return res.status(403).json({ error: 'Only the applicant may submit answers' });
    const questionId = req.body?.questionId, answerText = req.body?.answerText;
    if (typeof questionId !== 'string' || !/^q[1-5]$/.test(questionId) || typeof answerText !== 'string' || !answerText.trim() || answerText.length > 4000) return res.status(400).json({ error: 'Provide a non-empty answer of at most 4,000 characters' });
    const candidateName = application.candidate_name || profile.name;
    if (typeof candidateName !== 'string' || !candidateName.trim()) return res.status(400).json({ error: 'The candidate profile needs a name to resume assessment' });
    const identityContext = { sub:userId, role:'candidate', applicationId, candidateId:userId, employerId:job.employer_id, jobId:job.id };
    const response = await callGateway(req, `/pipeline/${encodeURIComponent(applicationId)}/answers`, 'POST', {
      questionId, answerText,
      candidate:{name:candidateName.trim()},
      job:{title:job.title,description:job.description||'',requiredSkills:Array.isArray(job.required_skills)?job.required_skills:[],preferredSkills:Array.isArray(job.preferred_skills)?job.preferred_skills:[]},
    }, identityContext);
    return res.status(response?.complete ? 202 : 200).json(response);
  } catch (error:any) {
    if (error?.message==='forbidden') return res.status(403).json({error:'Not authorized for this application'});
    if (error?.message==='not-found') return res.status(404).json({error:'Application or job not found'});
    if (error?.name==='ConditionalCheckFailedException') return res.status(409).json({error:'Interview answers changed concurrently. Refresh and try again.'});
    return gatewayFailure(res,error);
  }
}

export async function listAuthorizedApplications(req:Request,res:Response) {
  try {
    const uid=await identity(req), profile=await getProfile(uid); profile.role=await getRole(uid);
    const query=supabase.from('applications').select('*').order('applied_at',{ascending:false});
    if(profile.role==='candidate') query.eq('candidate_id',uid);
    else if(profile.role==='recruiter') query.eq('employer_id',uid);
    else return res.status(403).json({error:'Not authorized'});
    const {data,error}=await query; if(error) throw error;
    return res.json((data||[]).map((db:any)=>({id:db.id,jobId:db.job_id,employerId:db.employer_id,candidateId:db.candidate_id,candidateName:db.candidate_name,candidateEmail:db.candidate_email,appliedAt:Number(db.applied_at),status:db.status})))
  } catch(error:any) { if(error?.message==='forbidden') return res.status(403).json({error:'Not authorized'}); return fail(res,error); }
}
export async function createAuthorizedApplication(req:Request,res:Response) {
  try {
    const uid=await identity(req), profile=await getProfile(uid); profile.role=await getRole(uid); const app=req.body||{};
    if(profile.role!=='candidate'||app.candidateId!==uid||typeof app.id!=='string'||app.id.length>200||typeof app.jobId!=='string'||app.jobId.length>200) return res.status(403).json({error:'Not authorized to create this application'});
    const {data:job}=await supabase.from('jobs').select('id,employer_id').eq('id',app.jobId).maybeSingle();
    const external=app.jobId.startsWith('serp_')||app.jobId.startsWith('adzuna_');
    if(!job&&!external) return res.status(404).json({error:'Job not found'});
    const {error}=await supabase.from('applications').upsert({id:app.id,job_id:app.jobId,employer_id:job?.employer_id||null,candidate_id:uid,candidate_name:profile.name,candidate_email:profile.email,applied_at:app.appliedAt||Date.now(),status:'pending',resume_url:''});
    if(error) throw error; return res.json({success:true});
  } catch(error:any) { if(error?.message==='forbidden') return res.status(403).json({error:'Not authorized'}); return fail(res,error); }
}
export async function updateAuthorizedApplication(req:Request,res:Response) {
  try {
    const uid=await identity(req),profile=await getProfile(uid); profile.role=await getRole(uid);
    if(profile.role!=='recruiter') return res.status(403).json({error:'Recruiter access required'});
    const {data:app}=await supabase.from('applications').select('id,job_id,employer_id').eq('id',req.params.id).maybeSingle();
    if(!app||app.employer_id!==uid) return res.status(404).json({error:'Application not found'});
    const allowed=['pending','reviewed','accepted','rejected','on_hold'];
    if(!allowed.includes(req.body?.status)) return res.status(400).json({error:'Invalid application status'});
    const {error}=await supabase.from('applications').update({status:req.body.status}).eq('id',app.id).eq('employer_id',uid);
    if(error) throw error; return res.json({success:true});
  } catch(error:any) { if(error?.message==='forbidden') return res.status(403).json({error:'Not authorized'}); return fail(res,error); }
}
