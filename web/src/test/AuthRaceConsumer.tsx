import { useState } from "react";
import { useAuth } from "@/stores/auth";
import type { AuthenticationCompletion } from "@/stores/auth";
import {
  ACCOUNT_A_LOGIN,
  ACCOUNT_A_REGISTRATION,
  ACCOUNT_B_LOGIN,
  ACCOUNT_B_TOKEN,
  VERIFY_CODE,
} from "@/test/authRaceFixtures";

export function AuthRaceConsumer() {
  const {
    user,
    token,
    isLoading,
    twoFactorPending,
    tempToken,
    login,
    register,
    logout,
    setExternalToken,
    verifyTwoFactor,
  } = useAuth();
  const [operationResult, setOperationResult] = useState("idle");

  const runAuthenticationOperation = (
    operation: Promise<AuthenticationCompletion>,
  ): void => {
    setOperationResult("pending");
    void operation.then(
      (completion) => setOperationResult(completion.status),
      () => setOperationResult("rejected"),
    );
  };

  return (
    <>
      <output data-testid="auth-user-id">{user?.id ?? "none"}</output>
      <output data-testid="auth-token">{token ?? "none"}</output>
      <output data-testid="auth-loading">{String(isLoading)}</output>
      <output data-testid="two-factor-pending">
        {String(twoFactorPending)}
      </output>
      <output data-testid="temp-token">{tempToken ?? "none"}</output>
      <output data-testid="auth-operation-result">{operationResult}</output>
      <button
        type="button"
        onClick={() => runAuthenticationOperation(login(ACCOUNT_A_LOGIN))}
      >
        Start login A
      </button>
      <button
        type="button"
        onClick={() => runAuthenticationOperation(login(ACCOUNT_B_LOGIN))}
      >
        Start login B
      </button>
      <button
        type="button"
        onClick={() =>
          runAuthenticationOperation(register(ACCOUNT_A_REGISTRATION))
        }
      >
        Start registration A
      </button>
      <button
        type="button"
        onClick={() => runAuthenticationOperation(verifyTwoFactor(VERIFY_CODE))}
      >
        Verify account A
      </button>
      <button type="button" onClick={logout}>
        Log out
      </button>
      <button type="button" onClick={() => setExternalToken(ACCOUNT_B_TOKEN)}>
        Install external account B
      </button>
    </>
  );
}
