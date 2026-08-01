import type { ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

export function TasksKanbanTestProviders({
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
