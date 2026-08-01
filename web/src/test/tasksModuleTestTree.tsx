import { App as AntApp, ConfigProvider } from "antd";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import TasksModule from "@/pages/contact/modules/TasksModule";

export function TasksModuleTestTree({
  queryClient,
  vaultId,
  contactId,
}: {
  readonly queryClient: QueryClient;
  readonly vaultId: string;
  readonly contactId: string;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <AntApp>
          <MemoryRouter>
            <TasksModule vaultId={vaultId} contactId={contactId} />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
