// Compatibility gate: fail before guest rollout if the deployed API cannot provide
// the M4B source expected by the existing V17 frontend.
// Supply only a throwaway, authorized test session through the runner; no credentials
// are embedded in the repository. Never run against an unapproved listener.
export function assertV17M4bContract({frontendOperation, backendOperations}) {
  if(frontendOperation !== 'm4bSource') throw Error('UNEXPECTED_FRONTEND_OPERATION');
  if(!Array.isArray(backendOperations)||!backendOperations.includes(frontendOperation)){
    throw Error('M4B_API_NOT_DEPLOYED');
  }
  return true;
}
