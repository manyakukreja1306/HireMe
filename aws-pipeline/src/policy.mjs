export function scoreSkills(required = [], preferred = [], matched = [], partial = []) {
  const yes = new Set(matched.map(x => String(x).toLowerCase()));
  const half = new Set(partial.map(x => String(x).toLowerCase()));
  const coverage = skills => skills.length ? skills.reduce((sum, skill) => sum + (yes.has(String(skill).toLowerCase()) ? 1 : half.has(String(skill).toLowerCase()) ? 0.5 : 0), 0) / skills.length : null;
  const req = coverage(required), pref = coverage(preferred);
  const result = req === null ? (pref ?? 0) * 100 : pref === null ? req * 100 : (req * 0.7 + pref * 0.3) * 100;
  return Math.max(0, Math.min(100, Math.round(result)));
}
export function nextStage(score, threshold, hasAnswers, hasQuestions) {
  if (!Number.isFinite(score)) return 'NEEDS_REVIEW';
  if (hasAnswers) return 'EVALUATE_INTERVIEW';
  return hasQuestions ? 'INTERVIEW_PENDING' : 'GENERATE_QUESTIONS';
}
export function interviewComplete(interview) {
  return Boolean(interview && Number.isFinite(interview.interviewScore) && Array.isArray(interview.questions) && Array.isArray(interview.evaluations) && validInterviewEvaluations(interview.evaluations, interview.questions));
}
export function mayDraftOutreach(score, threshold, interview) {
  return score >= threshold && interviewComplete(interview);
}
export function validResumeResult(value) {
  const stringList=x=>Array.isArray(x)&&x.every(v=>typeof v==='string');
  const objectList=x=>Array.isArray(x)&&x.every(v=>v&&typeof v==='object'&&!Array.isArray(v));
  return Boolean(value && stringList(value.skills) && objectList(value.experience) && objectList(value.education) && stringList(value.certifications) && objectList(value.projects) && typeof value.summary === 'string' && stringList(value.extractionWarnings));
}
export function validMatchResult(value) {
  const stringList=x=>Array.isArray(x)&&x.length<=100&&x.every(v=>typeof v==='string'&&v.trim().length>0&&v.length<=1000);
  const noCriteria = value?.matchScore === null && value?.noCriteria === true && !value.requiredSkills?.length && !value.preferredSkills?.length && !value.matchedSkills?.length && !value.missingSkills?.length && !value.partialMatches?.length;
  const needsReview = value?.matchScore === null && value?.needsReview === true;
  const scoreValid = noCriteria || needsReview || (Number.isFinite(value?.matchScore) && value.matchScore >= 0 && value.matchScore <= 100 && value.noCriteria !== true && value.needsReview !== true);
  const citationsValid = Array.isArray(value?.criteria) && value.criteria.every(item => item && typeof item.criterion === 'string' && ['required','preferred'].includes(item.category) && ['full','partial','missing'].includes(item.rating) && typeof item.evidence === 'string' && (item.rating === 'missing' ? item.evidence === '' : item.evidence.length > 0 && Number.isInteger(item.startChar) && Number.isInteger(item.endChar) && item.startChar >= 0 && item.endChar > item.startChar));
  return Boolean(value && scoreValid && citationsValid && stringList(value.requiredSkills) && stringList(value.preferredSkills) && stringList(value.matchedSkills) && stringList(value.missingSkills) && stringList(value.partialMatches) && stringList(value.evidence) && typeof value.rationale === 'string' && value.rationale.length<=3000);
}
export function validInterviewQuestions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return false;
  const ids = new Set(value.map(q => q?.id));
  return ids.size === value.length && value.every(q => typeof q?.id === 'string' && /^q[1-5]$/.test(q.id) && typeof q?.question === 'string' && q.question.trim().length>0 && q.question.length<=1000 && typeof q?.skill === 'string' && q.skill.trim().length>0 && q.skill.length<=120);
}
export function validInterviewEvaluations(value, questions) {
  if (!Array.isArray(value) || value.length !== questions.length) return false;
  const ids = new Set(value.map(e => e?.questionId));
  return ids.size === questions.length && questions.every(q => ids.has(q.id)) && value.every(e => Number.isFinite(e.score) && e.score >= 0 && e.score <= 100 && typeof e.feedback === 'string' && e.feedback.length<=1500 && Array.isArray(e.evidence) && e.evidence.length<=20 && e.evidence.every(item => typeof item === 'string' && item.length<=1000));
}
export function validAnswerSet(answers, questions) {
  if (!Array.isArray(answers) || !Array.isArray(questions) || answers.length !== questions.length) return false;
  const ids = new Set(answers.map(a => a?.questionId));
  return ids.size === questions.length && questions.every(q => ids.has(q.id)) && answers.every(a => typeof a.answer === 'string' && a.answer.trim().length > 0 && a.answer.length <= 4000);
}
export function mergeAnswers(questions, previous = [], submitted = []) {
  if (!Array.isArray(questions) || !questions.length || !Array.isArray(previous) || !Array.isArray(submitted)) return null;
  const questionIds = new Set(questions.map(q => q?.id).filter(id => typeof id === 'string'));
  if (questionIds.size !== questions.length) return null;
  const merged = new Map();
  for (const answer of previous) if (questionIds.has(answer?.questionId) && typeof answer.answer === 'string' && answer.answer.length <= 4000) merged.set(answer.questionId, answer.answer);
  const seen = new Set();
  for (const answer of submitted) {
    if (typeof answer?.questionId !== 'string' || !questionIds.has(answer.questionId) || seen.has(answer.questionId)) return null;
    if (typeof answer.answer !== 'string' || answer.answer.length > 4000) return null;
    seen.add(answer.questionId);
    merged.set(answer.questionId, answer.answer);
  }
  const answers = questions.map(q => ({ questionId: q.id, answer: (merged.get(q.id) || '').trim() }));
  return { answers, complete: validAnswerSet(answers, questions) };
}
