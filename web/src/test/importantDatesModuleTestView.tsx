import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ImportantDatesModule from "@/pages/contact/modules/ImportantDatesModule";

export function ImportantDatesModuleTestView({
  vaultId = "v1",
  contactId = "c1",
}: {
  readonly vaultId?: string | number;
  readonly contactId?: string | number;
}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter>
            <ImportantDatesModule vaultId={vaultId} contactId={contactId} />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
