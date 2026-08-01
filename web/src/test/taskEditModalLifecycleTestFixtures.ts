import { QueryClient } from "@tanstack/react-query";
import type { VaultTask } from "@/api";

export type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: unknown) => void;
};

export const taskA = vaultTaskFixture(11, "Task A");
export const sameIdTaskInVaultB = vaultTaskFixture(11, "Vault B task");
export const taskB = vaultTaskFixture(22, "Task B");

export function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: Deferred<Value>["resolve"] = () => undefined;
  let rejectPromise: Deferred<Value>["reject"] = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function vaultTaskFixture(id: number, label: string): VaultTask {
  return { id, label, status: "todo", contacts: [] };
}
