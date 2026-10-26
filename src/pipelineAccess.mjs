export function canAccessApplication(role, userId, candidateId, employerId) {
  if (role === 'candidate') return userId === candidateId;
  if (role === 'recruiter') return userId === employerId;
  return false;
}
