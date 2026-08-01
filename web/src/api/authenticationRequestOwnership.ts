import { AxiosError } from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import {
  captureAuthenticationSubjectRevision,
  isAuthenticationSubjectRevisionCurrent,
} from "@/utils/authenticationSubjectRevision";
import type { AuthenticationSubjectRevision } from "@/utils/authenticationSubjectRevision";

export class AuthenticationRequestOwnership {
  readonly subjectRevision: AuthenticationSubjectRevision;
  readonly originalToken: string | null;
  readonly retryToken: string | null;

  constructor(
    subjectRevision: AuthenticationSubjectRevision,
    originalToken: string | null,
    retryToken: string | null,
  ) {
    this.subjectRevision = Object.freeze({ ...subjectRevision });
    this.originalToken = originalToken;
    this.retryToken = retryToken;
    Object.freeze(this);
  }

  static capture(token: string | null): AuthenticationRequestOwnership {
    return new AuthenticationRequestOwnership(
      captureAuthenticationSubjectRevision(),
      token,
      null,
    );
  }

  isCurrent(token: string | null): boolean {
    return (
      token === (this.retryToken ?? this.originalToken) &&
      isAuthenticationSubjectRevisionCurrent(this.subjectRevision)
    );
  }

  canRetryWithCurrentRotatedToken(
    currentToken: string | null,
  ): currentToken is string {
    return (
      this.retryToken === null &&
      currentToken !== null &&
      currentToken !== this.originalToken &&
      isAuthenticationSubjectRevisionCurrent(this.subjectRevision)
    );
  }

  withRetryToken(token: string): AuthenticationRequestOwnership {
    return new AuthenticationRequestOwnership(
      this.subjectRevision,
      this.originalToken,
      token,
    );
  }
}

export class StaleAuthenticationRequestError extends AxiosError {
  readonly name = "StaleAuthenticationRequestError";

  constructor(config: InternalAxiosRequestConfig) {
    super(
      "Authentication request ownership is stale",
      "ERR_STALE_AUTHENTICATION_REQUEST",
      config,
    );
  }
}
