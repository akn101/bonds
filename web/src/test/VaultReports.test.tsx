import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, App as AntApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  addresses: vi.fn(),
  importantDates: vi.fn(),
  mood: vi.fn(),
  map: vi.fn(),
  demographics: vi.fn(),
  interactions: vi.fn(),
  preferences: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    reports: {
      reportsOverviewList: mocks.overview,
      reportsAddressesList: mocks.addresses,
      reportsImportantDatesList: mocks.importantDates,
      reportsMoodTrackingEventsList: mocks.mood,
      reportsMapList: mocks.map,
      reportsDemographicsList: mocks.demographics,
      reportsInteractionsList: mocks.interactions,
      reportsAddressesCityDetail: vi.fn(),
      reportsAddressesCountryDetail: vi.fn(),
    },
    preferences: { preferencesList: mocks.preferences },
  },
}));

vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useParams: () => ({ id: "vault-1" }),
  useNavigate: () => vi.fn(),
}));

import VaultReports from "@/pages/vault/VaultReports";

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={client}>
          <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.preferences.mockResolvedValue({ data: { name_order: "%first_name% %last_name%" } });
  mocks.overview.mockResolvedValue({
    data: { total_contacts: 2, total_addresses: 1, total_important_dates: 1, total_mood_entries: 0 },
  });
  mocks.addresses.mockResolvedValue({ data: [] });
  mocks.importantDates.mockResolvedValue({ data: [] });
  mocks.mood.mockResolvedValue({ data: [] });
  mocks.map.mockResolvedValue({ data: { total_addresses: 0, geocoded_count: 0, points: [], countries: [] } });
  mocks.demographics.mockResolvedValue({ data: { total_contacts: 0, dimensions: [] } });
  mocks.interactions.mockResolvedValue({
    data: { total_activities: 0, total_interactions: 0, contact_count: 0, months: [], channels: [], most_frequent: [], gone_quiet: [] },
  });
});

describe("VaultReports", () => {
  it("keeps the sections the reports page has always had", async () => {
    renderPage(<VaultReports />);
    // These titles are also what the end-to-end test locates the page by.
    expect(await screen.findByText("Address Distribution")).toBeInTheDocument();
    expect(await screen.findByText("Important Dates Overview")).toBeInTheDocument();
    expect(await screen.findByText("Mood Trends")).toBeInTheDocument();
  });

  it("renders the map, cadence and demographics sections", async () => {
    renderPage(<VaultReports />);
    expect(await screen.findByText("Where they are")).toBeInTheDocument();
    expect(await screen.findByText("Staying in touch")).toBeInTheDocument();
    expect(await screen.findByText("Who they are")).toBeInTheDocument();
  });

  it("asks for two years of cadence by default", async () => {
    renderPage(<VaultReports />);
    await screen.findByText("Staying in touch");
    expect(mocks.interactions).toHaveBeenCalledWith("vault-1", { months: 24 });
  });

  it("explains an empty cadence chart instead of drawing nothing", async () => {
    mocks.interactions.mockResolvedValue({
      data: {
        total_activities: 7643, total_interactions: 0, contact_count: 0,
        months: [], channels: [], most_frequent: [], gone_quiet: [],
      },
    });
    renderPage(<VaultReports />);
    // A vault full of activities whose types are unflagged should be told why,
    // not shown a blank chart.
    expect(await screen.findByText("No activity type counts as an interaction")).toBeInTheDocument();
  });

  it("shows how many addresses are actually plotted", async () => {
    mocks.map.mockResolvedValue({
      data: {
        total_addresses: 379,
        geocoded_count: 12,
        points: [],
        countries: [{ country: "United Kingdom", address_count: 227, contact_count: 180, geocoded: 12 }],
      },
    });
    renderPage(<VaultReports />);
    expect(
      await screen.findByText(/12 of 379 addresses have coordinates/),
    ).toBeInTheDocument();
  });
});
