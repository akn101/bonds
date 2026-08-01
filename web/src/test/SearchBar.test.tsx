import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import SearchBar from "@/components/SearchBar";

const mockSearchList = vi.fn();

vi.mock("@/api", () => ({
  api: {
    search: {
      searchList: (...args: unknown[]) => mockSearchList(...args),
    },
  },
  httpClient: {
    instance: { get: vi.fn(), interceptors: { response: { use: vi.fn() } } },
  },
}));

function renderSearchBarWithoutVault() {
  return render(
    <ConfigProvider>
      <AntApp>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<SearchBar />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </ConfigProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderSearchBarInVault() {
  return render(
    <ConfigProvider>
      <AntApp>
        <MemoryRouter initialEntries={["/vaults/test-vault-id"]}>
          <Routes>
            <Route
              path="/vaults/:id"
              element={
                <>
                  <SearchBar />
                  <LocationProbe />
                </>
              }
            />
            <Route
              path="/vaults/:id/contacts/:contactId"
              element={
                <>
                  <SearchBar />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </ConfigProvider>,
  );
}

describe("SearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when no vault id is present", () => {
    const { container } = renderSearchBarWithoutVault();
    expect(
      container.querySelector(".ant-select-auto-complete"),
    ).not.toBeInTheDocument();
  });

  // Bug #31: After selecting a search result, the selected value (e.g. "contact:uuid")
  // should NOT be written back into the input field. The input should be cleared.
  it("clears input value after selecting a search result", async () => {
    mockSearchList.mockResolvedValue({
      data: {
        contacts: [{ id: "abc-123", name: "Alice Smith" }],
        notes: [],
      },
    });

    renderSearchBarInVault();
    const user = userEvent.setup();

    // AutoComplete without child <Input> renders placeholder as a separate div,
    // so use role="combobox" to find the actual input element.
    const input = screen.getByRole("combobox");
    await user.type(input, "Alice");

    // Wait for debounced search results to appear
    await waitFor(
      () => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // Click the result
    await user.click(screen.getByText("Alice Smith"));

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("shows Notes results and navigates a selected note to its source", async () => {
    // Given
    mockSearchList.mockResolvedValue({
      data: {
        contacts: [],
        notes: [
          {
            id: "17",
            contact_id: "contact-123",
            name: "Project history",
            type: "note",
          },
        ],
      },
    });
    renderSearchBarInVault();
    const user = userEvent.setup();

    // When
    await user.type(screen.getByRole("combobox"), "Project");

    // Then
    expect(
      await screen.findByText("Notes", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByText("Project history"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/vaults/test-vault-id/contacts/contact-123?focus=notes&source=Note:17",
      );
    });
  });
});
