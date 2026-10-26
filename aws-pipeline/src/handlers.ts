import { agentHandlers } from './agents.js';
import { publicApiHandler as handlePublicApi } from './public-api.js';
import { invokeAgent, readRecord, saveRecord, updateStatus, ddb, table, appKey, threshold } from './aws.js';
import { DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomUUID } from 'node:crypto';
import type { DecisionRecord, PipelineInput, PipelineStatus } from './types.js';
import { mayDraftOutreach, nextStage, validAnswerSet, validInterviewEvaluations } from './policy.mjs';

const now = () => new Date().toISOString();
const str = (v:any, name:string) => { if(typeof v!=='string'||! /^[a-zA-Z0-9_-]{1,200}$/.test(v)) throw new Error(`Invalid ${name}`); return v; };
const resumeRef = (v:any) => { if(typeof v!=='string'||!/^resumes\/[a-zA-Z0-9_-]{1,200}\/[a-zA-Z0-9_-]{1,200}\.(pdf|docx|txt)$/i.test(v)) throw new Error('Invalid resume reference'); return v; };
export async function runAgent(event:any, name:string) {
  try { const result = await agentHandlers[name](event); return result; }
  catch (error:any) { console.error(`${name} agent error`, error?.name || 'Error'); return { errorMessage: 'Agent failed', errorType: error?.name || 'AgentError' }; }
}
export const publicApiHandler=(event:any)=>handlePublicApi(event);
export const resumeHandler=(event:any)=>runAgent(event,'resume');
export const matchingHandler=(event:any)=>runAgent(event,'matching');
export const interviewHandler=(event:any)=>runAgent(event,'interview');
export const headhunterHandler=(event:any)=>runAgent(event,'headhunter');

function baseRecord(input:PipelineInput, prev:any): DecisionRecord {
  return { applicationId:input.applicationId,candidateId:input.candidateId,candidateSub:input.candidateId,employerId:input.employerId,recruiterSub:input.employerId,jobId:input.jobId,pipelineStatus:prev?.pipelineStatus||'PENDING',stage:prev?.stage||'UPLOADED',matchScore:prev?.match?.matchScore??null,interviewScore:prev?.interview?.interviewScore??null,matchedSkills:prev?.match?.matchedSkills||[],missingSkills:prev?.match?.missingSkills||[],interviewStrengths:prev?.interview?.strengths||[],interviewImprovementAreas:prev?.interview?.improvementAreas||[],outreachDraft:prev?.outreachDraft||null,outreachSubject:prev?.outreachSubject,outreachSent:prev?.outreachSent,rationale:prev?.rationale||'Assessment is in progress; recruiter review is required.',supportingEvidence:prev?.supportingEvidence||[],limitations:prev?.limitations||[],createdAt:prev?.createdAt||now(),updatedAt:now(),version:prev?.version||0,expiresAt:prev?.expiresAt||Math.floor(Date.now()/1000)+90*24*60*60 } as DecisionRecord;
}
function inputHash(input:PipelineInput) { return createHash('sha256').update(JSON.stringify({resumeKey:input.resumeKey,resumeDigest:input.resumeDigest,job:input.job})).digest('hex'); }
export async function orchestratorHandler(event:any) {
  let input:PipelineInput | undefined;
  try {
    input={applicationId:str(event.applicationId,'applicationId'),candidateId:str(event.candidateId,'candidateId'),employerId:str(event.employerId,'employerId'),jobId:str(event.jobId,'jobId'),resumeKey:resumeRef(event.resumeKey),resumeDigest:event.resumeDigest,job:event.job,candidate:event.candidate,answers:event.answers};
    if (!input.resumeKey.startsWith(`resumes/${input.candidateId}/${input.applicationId}.`) || !/\.(pdf|docx|txt)$/i.test(input.resumeKey)) throw new Error('Resume reference is invalid');
    if(typeof input.resumeDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.resumeDigest)) throw new Error('Resume digest is invalid');
    if (typeof input.job?.title!=='string'||!input.job.title.trim()||input.job.title.length>300||typeof input.job?.description!=='string'||!input.job.description.trim()||input.job.description.length>40000||typeof input.candidate?.name!=='string'||!input.candidate.name.trim()||input.candidate.name.length>200) throw new Error('Job and candidate records are required');
    const principal=event.principal;
    if (!principal || principal.applicationId!==input.applicationId || principal.candidateId!==input.candidateId || principal.employerId!==input.employerId || principal.jobId!==input.jobId || !['candidate','recruiter'].includes(principal.role) || (principal.role==='candidate'&&principal.sub!==input.candidateId) || (principal.role==='recruiter'&&principal.sub!==input.employerId)) throw new Error('Caller is not authorized for this application');
    const id=input.applicationId, key=appKey(id), lockKey={PK:key.PK,SK:'LOCK'}, prior=await readRecord(id), owner=randomUUID(), time=now();
    if (prior && (prior.candidateId!==input.candidateId || prior.jobId!==input.jobId || (prior.employerId && prior.employerId!==input.employerId))) throw new Error('Application ownership changed');
    // Atomic lease prevents simultaneous requests from overwriting the same application state.
    await ddb.send(new UpdateCommand({TableName:table,Key:lockKey,UpdateExpression:'SET leaseUntil = :lease, leaseOwner = :owner',ConditionExpression:'attribute_not_exists(leaseUntil) OR leaseUntil < :now',ExpressionAttributeValues:{':lease':Date.now()+240000,':now':Date.now(),':owner':owner}}));
    try {
      let record:any=prior||baseRecord(input, prior); const hash=inputHash(input);
      if (record.inputHash!==hash) { record={...baseRecord(input, {version:record.version,expiresAt:record.expiresAt}), inputHash:hash, resumeAnalysis:null, match:null, interview:null, outreachDraft:null}; }
      record.resumeKey=input.resumeKey; record.resumeDigest=input.resumeDigest;
      if ((!input.answers || !input.answers.length) && prior?.interviewAnswers?.length) input.answers=prior.interviewAnswers;
      record.pipelineStatus='PROCESSING'; record.stage='PARSING'; record.updatedAt=time; delete record.errorCode; await saveRecord(record);
      if (!record.resumeAnalysis) record.resumeAnalysis=await invokeAgent('resume',{applicationId:id,resumeKey:input.resumeKey,candidateName:input.candidate.name});
      record.stage='MATCHING'; await saveRecord(record);
      if ((record.resumeAnalysis.charCount ?? 0) < 200 || record.resumeAnalysis.extractionWarnings?.length) {
        record.pipelineStatus='NEEDS_REVIEW'; record.stage='PARSING'; record.matchScore=null; record.interviewScore=null;
        record.rationale='The resume contains too little extractable text or needs a human readability check. No match score was generated.';
        record.limitations=record.resumeAnalysis.extractionWarnings?.length ? record.resumeAnalysis.extractionWarnings : ['Fewer than 200 characters could be extracted from the resume.'];
        record.updatedAt=now(); await saveRecord(record);
        return { ...record, pipelineData:{resumeAnalysis:record.resumeAnalysis,match:null,interview:null} };
      }
      if (!record.match) record.match=await invokeAgent('matching',{applicationId:id,resume:record.resumeAnalysis,job:input.job});
      if (record.match.matchScore===null && (record.match.noCriteria===true || record.match.needsReview===true)) {
        record.pipelineStatus='NEEDS_REVIEW'; record.stage='MATCHING'; record.matchScore=null;
        record.rationale=record.match.noCriteria ? 'No concrete job requirements could be assessed from the job description. A recruiter must add or review job criteria; no match score was generated.' : 'Fewer than half of the job criteria had verifiable resume evidence. A recruiter must review the source; no match score was generated.';
        record.limitations=[record.rationale,'No interview or outreach draft was generated.'];
        record.supportingEvidence=record.match.evidence||[]; record.updatedAt=now(); await saveRecord(record);
        return { ...record, pipelineData:{resumeAnalysis:record.resumeAnalysis,match:record.match,interview:record.interview} };
      }
      if (!Number.isFinite(record.match.matchScore)||record.match.matchScore<0||record.match.matchScore>100) throw new Error('Matching agent returned an invalid score');
      record.matchScore=record.match.matchScore; record.matchedSkills=record.match.matchedSkills||[]; record.missingSkills=record.match.missingSkills||[];
      const stage=nextStage(record.matchScore,threshold,Boolean(input.answers?.length),Boolean(record.interview?.questions?.length));
      if (stage==='EVALUATE_INTERVIEW') {
        if (!validAnswerSet(input.answers, record.interview?.questions || [])) throw new Error('Interview answers do not cover the saved questions');
        record.pipelineStatus='PROCESSING'; record.stage='INTERVIEW_EVALUATING'; await saveRecord(record);
        const answersHash=createHash('sha256').update(JSON.stringify(input.answers)).digest('hex');
        if (!(record.interviewAnswerHash===answersHash && record.interview?.evaluations?.length)) {
          record.interview=await invokeAgent('interview',{applicationId:id,action:'evaluate',answers:input.answers});
          record.interviewAnswers=input.answers; record.interviewAnswerHash=answersHash;
        }
        if (!Number.isFinite(record.interview?.interviewScore) || !validInterviewEvaluations(record.interview.evaluations, record.interview.questions)) throw new Error('Interview evaluation missing or invalid');
        record.interviewScore=record.interview.interviewScore; record.interviewStrengths=record.interview.strengths||[]; record.interviewImprovementAreas=record.interview.improvementAreas||[];
        if (mayDraftOutreach(record.matchScore,threshold,record.interview) && !record.outreachDraft) { record.stage='DRAFTING'; await saveRecord(record); const draft=await invokeAgent('headhunter',{applicationId:id,candidate:input.candidate,resume:record.resumeAnalysis,job:input.job,match:record.match}); record.outreachDraft=draft.draft; record.outreachSubject=draft.subject; record.outreachSent=false; await saveRecord(record); }
        record.pipelineStatus='COMPLETE'; record.stage='COMPLETE'; record.rationale=`Match assessment: ${record.match.rationale} Interview assessment: ${record.interview.rationale}`.slice(0,4000);
        record.supportingEvidence=[...(record.match.evidence||[]),...(record.interview.evaluations||[]).flatMap((e:any)=>e.evidence||[])].slice(0,100); record.limitations=['Automated assessment can contain errors; recruiter review is required.'];
      } else {
        if (!record.interview?.questions?.length) record.interview=await invokeAgent('interview',{applicationId:id,action:'generate',resume:record.resumeAnalysis,job:input.job,match:record.match});
        record.pipelineStatus='PROCESSING'; record.stage='INTERVIEW_PENDING'; record.interviewScore=null; record.rationale='Interview questions are ready. The candidate can answer them; a person makes the hiring decision.';
        record.limitations=['Interview answers have not been evaluated.','AI output is decision support and requires human review.'];
      }
      record.updatedAt=now(); await saveRecord(record); return { ...record, pipelineData: { resumeAnalysis:record.resumeAnalysis, match:record.match, interview:record.interview } };
    } finally {
      await ddb.send(new DeleteCommand({TableName:table,Key:lockKey,ConditionExpression:'leaseOwner = :owner',ExpressionAttributeValues:{':owner':owner}})).catch(()=>undefined);
    }
  } catch(error:any) {
    if(error?.name==='ConditionalCheckFailedException') return { applicationId:input?.applicationId, pipelineStatus:'PROCESSING', message:'Another pipeline request is already processing this application.' };
    if (input) await updateStatus(input.applicationId,'FAILED',error?.name||'PipelineError').catch(()=>undefined);
    console.error('orchestrator error',error?.name||'Error');
    return { error: 'Pipeline could not be completed; retry is safe.', status:'FAILED' };
  }
}
