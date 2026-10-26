import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSkills, nextStage, interviewComplete, mayDraftOutreach, validResumeResult, validMatchResult, validInterviewQuestions, validInterviewEvaluations, validAnswerSet } from '../src/policy.mjs';
import { canAccessApplication } from '../../src/pipelineAccess.mjs';
import { mergeInterviewAnswers } from '../../src/interviewAnswers.mjs';
import { canAccessPipeline, signGatewayContext, verifyGatewayContext } from '../src/assertion.mjs';

test('matching score uses required/preferred coverage and stays bounded', () => {
  assert.equal(scoreSkills(['a','b'], ['c'], ['a','c'], []), 65);
  assert.equal(scoreSkills(['a'], [], ['a'], []), 100);
  assert.equal(scoreSkills(['a'], [], [], ['a']), 50);
  assert.equal(scoreSkills([], [], [], []), 0);
});

test('below-threshold applications still receive interview feedback but never recruiter outreach', () => {
  assert.equal(nextStage(69,70,true,false), 'EVALUATE_INTERVIEW');
  assert.equal(nextStage(69,70,false,false), 'GENERATE_QUESTIONS');
  assert.equal(nextStage(null,70,false,false), 'NEEDS_REVIEW');
  assert.equal(mayDraftOutreach(69,70,{interviewScore:100,evaluations:[{}]}), false);
});

test('generated questions do not count as a completed interview', () => {
  assert.equal(interviewComplete({ questions:[{id:'q1'}], evaluations:[], interviewScore:null }), false);
  assert.equal(nextStage(75,70,false,false), 'GENERATE_QUESTIONS');
  assert.equal(nextStage(75,70,false,true), 'INTERVIEW_PENDING');
});

test('outreach requires threshold and a real evaluated interview', () => {
  const evaluated={ questions:[{id:'q1'}], evaluations:[{questionId:'q1',score:80,feedback:'Evidence',evidence:[]}], interviewScore:80 };
  assert.equal(interviewComplete(evaluated), true);
  assert.equal(mayDraftOutreach(75,70,evaluated), true);
  assert.equal(mayDraftOutreach(75,70,{ evaluations:[], interviewScore:null }), false);
});

test('insufficient interview evidence cannot create an outreach draft', () => {
  assert.equal(mayDraftOutreach(90,70,{ interviewScore:null, questions:[{id:'q1'}], evaluations:[] }), false);
});

test('resume outputs require the complete structured schema', () => {
  assert.equal(validResumeResult({skills:[],experience:[],education:[],certifications:[],projects:[],summary:'',extractionWarnings:[]}),true);
  assert.equal(validResumeResult({skills:[],summary:''}),false);
});

test('matching output requires explicit skill gaps and rationale', () => {
  const citation={criterion:'SQL',category:'required',rating:'missing',evidence:'',startChar:null,endChar:null};
  assert.equal(validMatchResult({matchScore:0,requiredSkills:['SQL'],preferredSkills:[],matchedSkills:[],missingSkills:['SQL'],partialMatches:[],evidence:[],criteria:[citation],rationale:'Gap'}),true);
  assert.equal(validMatchResult({matchScore:null,noCriteria:true,needsReview:true,requiredSkills:[],preferredSkills:[],matchedSkills:[],missingSkills:[],partialMatches:[],evidence:[],criteria:[],rationale:'No criteria'}),true);
  assert.equal(validMatchResult({matchScore:null,requiredSkills:[],preferredSkills:[],matchedSkills:[],missingSkills:[],partialMatches:[],evidence:[],rationale:'Missing marker'}),false);
  assert.equal(validMatchResult({matchedSkills:[],rationale:'incomplete'}),false);
});

test('interview questions must have stable IDs and not exceed five', () => {
  assert.equal(validInterviewQuestions([{id:'q1',question:'Explain this project',skill:'React'}]),true);
  assert.equal(validInterviewQuestions(Array.from({length:6},(_,i)=>({id:`q${i}`,question:'Q',skill:'S'}))),false);
  assert.equal(validInterviewQuestions([{id:'q1',question:'Q1',skill:'S'},{id:'q1',question:'Q2',skill:'S'}]),false);
});

test('evaluation requires one bounded real evaluation for each question', () => {
  const questions=[{id:'q1'},{id:'q2'}];
  assert.equal(validInterviewEvaluations([{questionId:'q1',score:70,feedback:'Good',evidence:[]},{questionId:'q2',score:90,feedback:'Clear',evidence:[]}],questions),true);
  assert.equal(validInterviewEvaluations([{questionId:'q1',score:101,feedback:'Bad',evidence:[]}],questions),false);
});

test('answers must match saved question IDs and cover every question', () => {
  const questions=[{id:'q1'},{id:'q2'}];
  assert.equal(validAnswerSet([{questionId:'q1',answer:'Answer one'},{questionId:'q2',answer:'Answer two'}],questions),true);
  assert.equal(validAnswerSet([{questionId:'q1',answer:'Answer one'}],questions),false);
});

test('partial interview drafts preserve prior answers until all questions are answered', () => {
  const questions=[{id:'q1'},{id:'q2'}];
  const first=mergeInterviewAnswers(questions,[],[{questionId:'q1',answer:'  First answer  '}]);
  assert.deepEqual(first,{answers:[{questionId:'q1',answer:'First answer'},{questionId:'q2',answer:''}],complete:false});
  const resumed=mergeInterviewAnswers(questions,first.answers,[{questionId:'q2',answer:'Second answer'}]);
  assert.deepEqual(resumed,{answers:[{questionId:'q1',answer:'First answer'},{questionId:'q2',answer:'Second answer'}],complete:true});
});

test('interview draft merge rejects duplicate, unknown, and oversized answers', () => {
  const questions=[{id:'q1'},{id:'q2'}];
  assert.equal(mergeInterviewAnswers(questions,[],[{questionId:'q1',answer:'a'},{questionId:'q1',answer:'b'}]),null);
  assert.equal(mergeInterviewAnswers(questions,[],[{questionId:'q3',answer:'a'}]),null);
  assert.equal(mergeInterviewAnswers(questions,[],[{questionId:'q1',answer:'x'.repeat(4001)}]),null);
});

test('candidates cannot access another candidate application', () => {
  assert.equal(canAccessApplication('candidate','cand-1','cand-1','rec-1'),true);
  assert.equal(canAccessApplication('candidate','cand-2','cand-1','rec-1'),false);
});

test('recruiters can access only applications for their own jobs', () => {
  assert.equal(canAccessApplication('recruiter','rec-1','cand-1','rec-1'),true);
  assert.equal(canAccessApplication('recruiter','rec-2','cand-1','rec-1'),false);
  assert.equal(canAccessApplication('guest','guest','cand-1','rec-1'),false);
});

test('API ownership checks restrict candidate and recruiter views to their application', () => {
  const record={applicationId:'app-1',candidateId:'cand-1',employerId:'rec-1',jobId:'job-1'};
  assert.equal(canAccessPipeline({applicationId:'app-1',jobId:'job-1',role:'candidate',sub:'cand-1',candidateId:'cand-1'},record),true);
  assert.equal(canAccessPipeline({applicationId:'app-1',jobId:'job-1',role:'candidate',sub:'cand-2',candidateId:'cand-2'},record),false);
  assert.equal(canAccessPipeline({applicationId:'app-1',jobId:'job-1',role:'recruiter',sub:'rec-1',employerId:'rec-1'},record),true);
  assert.equal(canAccessPipeline({applicationId:'app-1',jobId:'job-1',role:'recruiter',sub:'rec-2',employerId:'rec-2'},record),false);
});

test('Gateway ownership context is signed, bound to request bytes and expires', () => {
  const secret='a sufficiently long integration test secret';
  const request={timestamp:'1761444000000',method:'POST',path:'/pipeline/app-1/run',body:'{"resumeKey":"resumes/cand-1/app-1.pdf"}',context:{sub:'cand-1',role:'candidate',applicationId:'app-1',candidateId:'cand-1',employerId:'rec-1',jobId:'job-1'}};
  const signed=signGatewayContext(secret,request);
  const valid=verifyGatewayContext({secret,...request,encodedContext:signed.encodedContext,signature:signed.signature,tokenSubject:'cand-1',now:Number(request.timestamp)});
  assert.equal(valid.applicationId,'app-1');
  assert.equal(verifyGatewayContext({secret,...request,body:'different',encodedContext:signed.encodedContext,signature:signed.signature,tokenSubject:'cand-1',now:Number(request.timestamp)}),null);
  assert.equal(verifyGatewayContext({secret,...request,encodedContext:signed.encodedContext,signature:signed.signature,tokenSubject:'attacker',now:Number(request.timestamp)}),null);
  assert.equal(verifyGatewayContext({secret,...request,encodedContext:signed.encodedContext,signature:signed.signature,tokenSubject:'cand-1',now:Number(request.timestamp)+60_001}),null);
});
