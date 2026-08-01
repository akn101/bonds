import { useCallback, useState, type ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import TaskEditModal from "@/pages/vault/TaskEditModal";
import type { VaultTask } from "@/api";
import { taskA, taskB } from "./taskEditModalLifecycleTestFixtures";

type ControlledModalHarnessProps = {
  readonly task: VaultTask;
  readonly vaultId: string;
  readonly onCloseObserved: () => void;
};

export function TaskEditModalTestProviders({
  children,
  queryClient,
}: {
  readonly children: ReactNode;
  readonly queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>{children}</App>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

export function ControlledModalHarness({
  task,
  vaultId,
  onCloseObserved,
}: ControlledModalHarnessProps) {
  const [open, setOpen] = useState(true);
  const onClose = useCallback(() => {
    onCloseObserved();
    setOpen(false);
  }, [onCloseObserved]);

  return (
    <TaskEditModal
      open={open}
      vaultId={vaultId}
      task={task}
      statuses={[]}
      onClose={onClose}
    />
  );
}

export function ControlledCreateModalHarness({
  onCloseObserved,
}: {
  readonly onCloseObserved: () => void;
}) {
  const [open, setOpen] = useState(true);
  const onClose = useCallback(() => {
    onCloseObserved();
    setOpen(false);
  }, [onCloseObserved]);

  return (
    <TaskEditModal
      open={open}
      vaultId="vault-a"
      task={null}
      defaultStatus="todo"
      statuses={[]}
      onClose={onClose}
    />
  );
}

export function ReopenModalHarness({
  onCloseObserved,
}: {
  readonly onCloseObserved: () => void;
}) {
  const [modal, setModal] = useState({
    open: true,
    task: taskA,
    vaultId: "vault-a",
  });
  const onClose = useCallback(() => {
    onCloseObserved();
    setModal((current) => ({ ...current, open: false }));
  }, [onCloseObserved]);

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setModal({ open: true, task: taskB, vaultId: "vault-a" })
        }
      >
        Open task B
      </button>
      <TaskEditModal
        open={modal.open}
        vaultId={modal.vaultId}
        task={modal.task}
        statuses={[]}
        onClose={onClose}
      />
    </>
  );
}
