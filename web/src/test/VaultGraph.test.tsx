import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VaultGraph from "@/pages/vault/VaultGraph";
import NetworkGraph from "@/components/NetworkGraph";
import {
  vaultGraphQueryKey,
  vaultGraphURL,
} from "@/components/networkGraphQueryKey";

const httpMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/api", () => ({
  httpClient: { instance: { get: httpMocks.get } },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...(actual as object),
    useParams: () => ({ id: "vault-1" }),
  };
});

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}

function graphResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      success: true,
      data: {
        nodes: [
          { id: "a", label: "Alice", is_center: false },
          { id: "b", label: "Bob", is_center: false },
        ],
        edges: [],
        components: 1,
        isolated_contacts: 0,
        external_relationships: 0,
        truncated: false,
        facets: [],
        filtered_out: 0,
        ...overrides,
      },
    },
  };
}

beforeEach(() => {
  httpMocks.get.mockReset();
});

describe("VaultGraph page", () => {
  it("reads the whole vault rather than one contact's component", async () => {
    httpMocks.get.mockResolvedValue(graphResponse());

    renderWithProviders(<VaultGraph />);

    await waitFor(() => expect(httpMocks.get).toHaveBeenCalled());
    expect(httpMocks.get).toHaveBeenCalledWith(
      "/vaults/vault-1/relationships/graph?limit=1000",
    );
    expect(await screen.findByText("2 contacts drawn")).toBeInTheDocument();
  });

  // A vault whose largest cluster alone exceeds the default is the case this
  // control exists for: without it the page shows a fraction and says so.
  it("re-asks the server when the reader raises the limit", async () => {
    httpMocks.get.mockResolvedValue(graphResponse({ truncated: true }));

    renderWithProviders(<VaultGraph />);
    await screen.findByText("2 contacts drawn");

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("2500 contacts"));

    await waitFor(() =>
      expect(httpMocks.get).toHaveBeenCalledWith(
        "/vaults/vault-1/relationships/graph?limit=2500",
      ),
    );
  });

  it("accounts for the contacts and relationships it left out", async () => {
    httpMocks.get.mockResolvedValue(
      graphResponse({
        components: 3,
        isolated_contacts: 7,
        external_relationships: 2,
        truncated: true,
      }),
    );

    renderWithProviders(<VaultGraph />);

    expect(await screen.findByText("3 separate clusters")).toBeInTheDocument();
    expect(
      screen.getByText("7 not shown, with no relationship inside this vault"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 relationships lead outside this vault"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Too large to draw in full; the smallest clusters were left out",
      ),
    ).toBeInTheDocument();
  });

  it("stays quiet about exclusions that did not happen", async () => {
    httpMocks.get.mockResolvedValue(graphResponse());

    renderWithProviders(<VaultGraph />);

    await screen.findByText("2 contacts drawn");
    expect(screen.queryByText(/not shown/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lead outside/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Too large/)).not.toBeInTheDocument();
    expect(screen.queryByText(/separate clusters/)).not.toBeInTheDocument();
  });

  // The page and the canvas are two components reading the same thing; keying
  // them identically is what keeps that to a single request.
  it("shares one request with the canvas it renders", async () => {
    httpMocks.get.mockResolvedValue(graphResponse());

    renderWithProviders(
      <>
        <VaultGraph />
        <NetworkGraph vaultId="vault-1" limit={1000} />
      </>,
    );

    await screen.findByText("2 contacts drawn");
    await waitFor(() => expect(httpMocks.get).toHaveBeenCalledTimes(1));
    expect(vaultGraphQueryKey("vault-1", 1000)).toEqual([
      "vaults",
      "vault-1",
      "graph",
      1000,
      "",
    ]);
  });
});

describe("NetworkGraph in vault mode", () => {
  it("calls the vault endpoint and shows the vault-specific empty state", async () => {
    httpMocks.get.mockResolvedValue({
      data: { success: true, data: { nodes: [], edges: [] } },
    });

    renderWithProviders(
      <NetworkGraph
        vaultId="vault-1"
        emptyDescription="Nothing related in here"
      />,
    );

    await waitFor(() =>
      expect(httpMocks.get).toHaveBeenCalledWith(
        "/vaults/vault-1/relationships/graph",
      ),
    );
    expect(
      await screen.findByText("Nothing related in here"),
    ).toBeInTheDocument();
  });

  it("still calls the per-contact endpoint when given a contact", async () => {
    httpMocks.get.mockResolvedValue({
      data: { success: true, data: { nodes: [], edges: [] } },
    });

    renderWithProviders(
      <NetworkGraph vaultId="vault-1" contactId="contact-9" />,
    );

    await waitFor(() =>
      expect(httpMocks.get).toHaveBeenCalledWith(
        "/vaults/vault-1/contacts/contact-9/relationships/graph",
      ),
    );
  });
});

// The server omits facets nothing in the vault carries, so a vault where
// nobody has a gender set must not be given a gender control to poke at.
describe("VaultGraph filtering", () => {
  const withFacets = () =>
    graphResponse({
      facets: [
        {
          key: "label",
          values: [
            { value: "3", label: "school", count: 12 },
            { value: "7", label: "family", count: 4 },
          ],
        },
      ],
    });

  it("offers a control only for the facets the vault carries", async () => {
    httpMocks.get.mockResolvedValue(withFacets());

    renderWithProviders(<VaultGraph />);

    expect(await screen.findByLabelText("Labels")).toBeInTheDocument();
    expect(screen.queryByLabelText("Gender")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Groups")).not.toBeInTheDocument();
  });

  it("asks the server for the narrowed graph when a value is picked", async () => {
    httpMocks.get.mockResolvedValue(withFacets());

    renderWithProviders(<VaultGraph />);
    await screen.findByLabelText("Labels");

    fireEvent.mouseDown(screen.getByLabelText("Labels"));
    fireEvent.click(await screen.findByTitle("school (12)"));

    await waitFor(() =>
      expect(httpMocks.get).toHaveBeenCalledWith(
        "/vaults/vault-1/relationships/graph?limit=1000&label=3",
      ),
    );
  });

  it("accounts for the contacts the filter took off the canvas", async () => {
    httpMocks.get.mockResolvedValue(
      graphResponse({ facets: [], filtered_out: 9 }),
    );

    renderWithProviders(<VaultGraph />);

    expect(await screen.findByText("9 filtered out")).toBeInTheDocument();
  });

  it("stays quiet about a filter that excluded nobody", async () => {
    httpMocks.get.mockResolvedValue(graphResponse());

    renderWithProviders(<VaultGraph />);

    await screen.findByText("2 contacts drawn");
    expect(screen.queryByText(/filtered out/)).not.toBeInTheDocument();
  });
});

// Two selections made in a different order are the same graph, so they must be
// the same cache entry and the same request.
describe("vaultGraphQueryKey", () => {
  it("keys a selection the same however it was ordered", () => {
    expect(vaultGraphQueryKey("vault-1", 400, { label: ["7", "3"] })).toEqual(
      vaultGraphQueryKey("vault-1", 400, { label: ["3", "7"] }),
    );
  });

  it("keys different selections differently", () => {
    expect(vaultGraphQueryKey("vault-1", 400, { label: ["3"] })).not.toEqual(
      vaultGraphQueryKey("vault-1", 400, { group: ["3"] }),
    );
  });

  it("drops empty selections rather than sending them", () => {
    expect(vaultGraphURL("vault-1", 400, { label: [], group: [""] })).toBe(
      "/vaults/vault-1/relationships/graph?limit=400",
    );
  });
});
