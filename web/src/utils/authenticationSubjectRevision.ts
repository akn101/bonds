export type AuthenticationSubjectRevision = Readonly<{
  kind: "authentication-subject-revision";
  value: number;
}>;

export type AuthenticationAttemptRevision = Readonly<{
  kind: "authentication-attempt-revision";
  value: number;
}>;

type AuthenticationSubjectTerminationListener = () => void;
type AuthenticationTokenReplacementListener = (token: string) => void;

let currentSubjectRevision: AuthenticationSubjectRevision = {
  kind: "authentication-subject-revision",
  value: 0,
};
let currentAttemptRevision: AuthenticationAttemptRevision = {
  kind: "authentication-attempt-revision",
  value: 0,
};
const subjectTerminationListeners =
  new Set<AuthenticationSubjectTerminationListener>();
const tokenReplacementListeners =
  new Set<AuthenticationTokenReplacementListener>();

export function advanceAuthenticationSubjectRevision(): AuthenticationSubjectRevision {
  currentSubjectRevision = {
    kind: "authentication-subject-revision",
    value: currentSubjectRevision.value + 1,
  };
  advanceAuthenticationAttemptRevision();
  return currentSubjectRevision;
}

export function captureAuthenticationSubjectRevision(): AuthenticationSubjectRevision {
  return currentSubjectRevision;
}

export function isAuthenticationSubjectRevisionCurrent(
  revision: AuthenticationSubjectRevision,
): boolean {
  return revision.value === currentSubjectRevision.value;
}

export function advanceAuthenticationAttemptRevision(): AuthenticationAttemptRevision {
  currentAttemptRevision = {
    kind: "authentication-attempt-revision",
    value: currentAttemptRevision.value + 1,
  };
  return currentAttemptRevision;
}

export function isAuthenticationAttemptRevisionCurrent(
  revision: AuthenticationAttemptRevision,
): boolean {
  return revision.value === currentAttemptRevision.value;
}

export function subscribeAuthenticationSubjectTermination(
  listener: AuthenticationSubjectTerminationListener,
): () => void {
  subjectTerminationListeners.add(listener);
  return () => subjectTerminationListeners.delete(listener);
}

export function subscribeAuthenticationTokenReplacement(
  listener: AuthenticationTokenReplacementListener,
): () => void {
  tokenReplacementListeners.add(listener);
  return () => tokenReplacementListeners.delete(listener);
}

export function replaceCurrentAuthenticationToken(token: string): void {
  // Token rotation keeps the same subject revision, so Provider state needs a separate replacement signal.
  localStorage.setItem("token", token);
  tokenReplacementListeners.forEach((listener) => listener(token));
}

export function terminateCurrentAuthenticationSubject(): void {
  advanceAuthenticationSubjectRevision();
  localStorage.removeItem("token");
  subjectTerminationListeners.forEach((listener) => listener());
}
