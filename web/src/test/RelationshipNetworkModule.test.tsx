import { App as AntApp, ConfigProvider } from "antd";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RelationshipNetworkModule from "@/pages/contact/modules/RelationshipNetworkModule";

vi.mock("@/components/NetworkGraph", () => ({
  default: ({ vaultId, contactId }: { vaultId: string; contactId: string }) => (
    <div data-testid="network-graph">{vaultId}:{contactId}</div>
  ),
}));

describe("RelationshipNetworkModule", () => {
  it("owns exactly one graph rendering", () => {
    render(
      <ConfigProvider>
        <AntApp>
          <RelationshipNetworkModule vaultId="vault-1" contactId="contact-1" />
        </AntApp>
      </ConfigProvider>,
    );

    expect(screen.getAllByTestId("network-graph")).toHaveLength(1);
    expect(screen.getByText("vault-1:contact-1")).toBeInTheDocument();
  });
});
