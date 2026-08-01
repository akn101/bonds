import { App as AntApp, ConfigProvider } from "antd";
import { MemoryRouter } from "react-router-dom";
import RemindersModule from "@/pages/contact/modules/RemindersModule";
import type { NormalizedFeedSource } from "@/utils/feedSourceLink";

type ReminderTarget = Extract<
  NormalizedFeedSource,
  { readonly module: "reminders" }
>;

export function RemindersModuleTestView({
  vaultId = "v1",
  contactId = "c1",
  target,
}: {
  readonly vaultId?: string | number;
  readonly contactId?: string | number;
  readonly target?: ReminderTarget;
}) {
  return (
    <ConfigProvider>
      <AntApp>
        <MemoryRouter>
          <RemindersModule
            vaultId={vaultId}
            contactId={contactId}
            target={target}
          />
        </MemoryRouter>
      </AntApp>
    </ConfigProvider>
  );
}
