import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Sparkles, Loader2 } from 'lucide-react';

type Assessment = {
  pipelineStatus?: string; stage?: string; matchScore?: number | null; interviewScore?: number | null;
  matchedSkills?: string[]; missingSkills?: string[]; rationale?: string; supportingEvidence?: string[];
  resumeWarnings?: string[]; humanReviewRequired?: boolean; candidateFeedback?: string | null;
  resumeDownloadUrl?: string;
  auditSummary?: {agent:string;promptVersion:string;inputHash:string;outputHash:string;durationMs:number;result:string}[];
  pipelineData?: { match?: { criteria?: {criterion:string;category:string;rating:string;evidence:string}[] } };
  interviewAnswers?: { questionId: string; answer: string }[];
  outreachDraft?: string | null; outreachSubject?: string; outreachSent?: false; interview?: { questions?: { id: string; question: string; skill: string }[]; evaluations?: { questionId: string; score?: number; feedback: string; evidence?: string[] }[]; strengths?: string[]; improvementAreas?: string[] };
};
const labels: Record<string,string> = { PENDING:'Assessment queued', PROCESSING:'Assessment in progress', COMPLETE:'Assessment complete', NEEDS_REVIEW:'Needs human review', FAILED:'Assessment failed; a safe retry is available' };
const stageLabels: Record<string,string> = { UPLOADED:'Uploaded', PARSING:'Parsing resume', MATCHING:'Matching to job criteria', INTERVIEW_PENDING:'Interview questions ready', INTERVIEW_EVALUATING:'Evaluating interview answers', DRAFTING:'Preparing outreach draft', COMPLETE:'Complete' };

export function PipelineAssessment({ applicationId, jobId, resumeDataUrl, recruiter=false }: { applicationId: string; jobId?: string; resumeDataUrl?: string; recruiter?: boolean }) {
  const { getToken } = useAuth();
  const [record, setRecord] = useState<Assessment | null>(null);
  const [answers, setAnswers] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const pollStartedAt = useRef(Date.now());
  const lastPollAt = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const token = await getToken({ template: 'hirely-api' });
      const response = await fetch(`/api/pipeline/${encodeURIComponent(applicationId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setRecord(await response.json());
    } catch { /* assessment may not be configured yet */ }
    finally { setLoading(false); }
  }, [applicationId, getToken]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (record?.pipelineStatus !== 'PROCESSING') return;
      const now=Date.now(), interval=now-pollStartedAt.current<60_000?3_000:10_000;
      if(now-lastPollAt.current>=interval){lastPollAt.current=now;void refresh();}
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refresh, record?.pipelineStatus]);
  useEffect(() => {
    if (!Object.keys(answers).length && record?.interviewAnswers?.length) {
      setAnswers(Object.fromEntries(record.interviewAnswers.map(answer => [answer.questionId, answer.answer])));
    }
  }, [answers, record?.interviewAnswers]);

  const submit = async () => {
    if (!record?.interview?.questions?.length) return;
    setSubmitting(true); setMessage('');
    try {
      const token = await getToken({ template: 'hirely-api' });
      let data:any;
      for (const question of record.interview.questions) {
        const answerText = answers[question.id] || '';
        if (!answerText.trim()) throw new Error('Please answer every question before submitting.');
        const response = await fetch('/api/pipeline/answers', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify({ applicationId, questionId:question.id, answerText }) });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not submit answers');
      }
      setMessage(data?.complete ? 'Answers submitted. Evaluation is in progress.' : 'Answers saved.');
      await refresh();
    } catch (error:any) { setMessage(error.message || 'Could not submit answers'); }
    finally { setSubmitting(false); }
  };
  if (loading && !record) return <p className="text-xs text-slate-400">Loading assessment…</p>;
  if (!record) return <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500"><p>AI-assisted decision support has not started for this application.</p>{!recruiter && jobId && resumeDataUrl && !jobId.startsWith('serp_') && !jobId.startsWith('adzuna_') && <button disabled={submitting} onClick={async()=>{setSubmitting(true);setMessage('');try{const token=await getToken({template:'hirely-api'});const response=await fetch('/api/pipeline/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({applicationId,resumeDataUrl})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Assessment could not be started');setRecord({pipelineStatus:data.status});setMessage('Assessment queued.');await refresh();}catch(error:any){setMessage(error.message||'Assessment could not be started');}finally{setSubmitting(false);}}} className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:opacity-50">{submitting?'Starting…':'Start assessment'}</button>}{message&&<p className="mt-2">{message}</p>}</div>;
  return <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-sm">
    <div className="flex items-center gap-2 font-bold text-indigo-800"><Sparkles className="h-4 w-4" /> AI-assisted decision support · {labels[record.pipelineStatus || ''] || record.pipelineStatus}</div>
    {record.stage && <p className="mt-1 text-xs text-slate-500" role="status" aria-live="polite">Stage: {stageLabels[record.stage] || record.stage}</p>}
    {recruiter && record.resumeDownloadUrl && <a href={record.resumeDownloadUrl} className="mt-2 inline-block font-semibold text-indigo-700 underline">Download resume</a>}
    {recruiter && record.matchScore != null && <p className="mt-2 text-slate-700">Job match: <strong>{record.matchScore}%</strong>{record.interviewScore != null && <> · Interview: <strong>{record.interviewScore}%</strong></>}</p>}
    {recruiter && record.pipelineData?.match?.criteria?.length ? <div className="mt-3 overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead><tr><th className="border-b p-2">Criterion</th><th className="border-b p-2">Type</th><th className="border-b p-2">Evidence</th><th className="border-b p-2">Rating</th></tr></thead><tbody>{record.pipelineData.match.criteria.map((criterion,i)=><tr key={`${criterion.criterion}-${i}`}><td className="border-b p-2 font-medium">{criterion.criterion}</td><td className="border-b p-2">{criterion.category}</td><td className="border-b p-2">{criterion.evidence ? `“${criterion.evidence}”` : 'No verified quote'}</td><td className="border-b p-2">{criterion.rating}</td></tr>)}</tbody></table></div> : null}
    {record.humanReviewRequired && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-900">Needs human review{record.resumeWarnings?.length ? <ul className="mt-1 list-disc pl-5 font-normal">{record.resumeWarnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul> : <p className="mt-1 font-normal">There is not enough verified evidence to calculate a match score.</p>}</div>}
    {record.matchedSkills?.length ? <p className="mt-2 text-slate-600">Matched: {record.matchedSkills.join(', ')}</p> : null}
    {record.missingSkills?.length ? <p className="mt-1 text-slate-600">Gaps: {record.missingSkills.join(', ')}</p> : null}
    {record.rationale && <p className="mt-2 text-slate-600">{record.rationale}</p>}
    {record.interview?.questions?.length && !record.interview?.evaluations?.length && !recruiter && <div className="mt-4 space-y-3">
      <p className="font-semibold text-slate-800">Answer these job related questions to complete your interview:</p>
      {record.interview.questions.map((q,i)=><label key={q.id} className="block text-slate-700"><span className="mb-1 block font-medium">{i+1}. {q.question}</span><textarea value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} rows={3} maxLength={4000} className="w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm" placeholder="Your answer" /></label>)}
      <button onClick={submit} disabled={submitting || record.stage==='INTERVIEW_EVALUATING' || record.pipelineStatus==='COMPLETE'} className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{submitting ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Saving…</> : 'Submit interview answers'}</button>
      {message && <p className="text-xs text-slate-600">{message}</p>}
    </div>}
    {record.interview?.evaluations?.length ? <div className="mt-3 space-y-2"><h4 className="font-semibold text-slate-800">Interview feedback</h4>{record.interview.evaluations.map(e=><p key={e.questionId} className="text-slate-600">{e.feedback}</p>)}</div> : null}
    {record.interview?.strengths?.length ? <p className="mt-2 text-slate-600">Strengths: {record.interview.strengths.join('; ')}</p> : null}
    {record.interview?.improvementAreas?.length ? <p className="mt-1 text-slate-600">Areas to develop: {record.interview.improvementAreas.join('; ')}</p> : null}
    {recruiter && record.supportingEvidence?.length ? <ul className="mt-2 list-disc pl-5 text-slate-600">{record.supportingEvidence.slice(0,8).map((e,i)=><li key={i}>{e}</li>)}</ul> : null}
    {recruiter && record.auditSummary?.length ? <details className="mt-3"><summary className="cursor-pointer font-semibold text-slate-700">Assessment audit summary</summary><ul className="mt-2 space-y-1 text-xs text-slate-600">{record.auditSummary.map((item,i)=><li key={`${item.agent}-${i}`}>{item.agent} · {item.promptVersion} · {item.durationMs} ms · output {item.outputHash.slice(0,12)}…</li>)}</ul></details> : null}
    {recruiter && record.outreachDraft && <details className="mt-3"><summary className="cursor-pointer font-semibold text-indigo-700">Draft — not sent</summary><p className="mt-2 font-semibold text-slate-800">{record.outreachSubject}</p><p className="mt-2 whitespace-pre-wrap text-slate-700">{record.outreachDraft}</p><button onClick={()=>void navigator.clipboard.writeText(record.outreachDraft || '')} className="mt-2 rounded-lg border border-indigo-200 px-3 py-1.5 font-semibold text-indigo-700">Copy draft</button></details>}
    {record.pipelineStatus==='FAILED' && !recruiter && resumeDataUrl && <button onClick={async()=>{try{const token=await getToken({template:'hirely-api'});const response=await fetch('/api/pipeline/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({applicationId,resumeDataUrl})});if(!response.ok)throw new Error('Retry could not be started');setRecord({...record,pipelineStatus:'PENDING'});setMessage('Retry queued.');await refresh();}catch(error:any){setMessage(error.message||'Assessment could not be started');}}} className="mt-3 rounded-lg border border-indigo-200 px-3 py-1.5 font-semibold text-indigo-700">Retry assessment</button>}
    <p className="mt-3 text-[11px] text-slate-500">AI helps organize evidence and feedback. A person makes every hiring decision. AI output may contain errors.</p>
  </div>;
}
