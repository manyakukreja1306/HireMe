export function mergeInterviewAnswers(questions, previousAnswers = [], submittedAnswers = []) {
  if (!Array.isArray(questions) || !questions.length || !Array.isArray(previousAnswers) || !Array.isArray(submittedAnswers)) return null;

  const questionIds = new Set(questions.map(question => question?.id).filter(id => typeof id === 'string'));
  if (questionIds.size !== questions.length) return null;

  const submittedIds = new Set();
  for (const answer of submittedAnswers) {
    if (typeof answer?.questionId !== 'string' || !questionIds.has(answer.questionId) || submittedIds.has(answer.questionId)) return null;
    if (typeof answer.answer !== 'string' || answer.answer.length > 4000) return null;
    submittedIds.add(answer.questionId);
  }

  const savedAnswers = new Map();
  for (const answer of previousAnswers) {
    if (questionIds.has(answer?.questionId) && typeof answer.answer === 'string' && answer.answer.length <= 4000) {
      savedAnswers.set(answer.questionId, answer.answer);
    }
  }
  for (const answer of submittedAnswers) savedAnswers.set(answer.questionId, answer.answer);

  const answers = questions.map(question => ({ questionId: question.id, answer: (savedAnswers.get(question.id) || '').trim() }));
  return { answers, complete: answers.every(answer => answer.answer.length > 0) };
}
