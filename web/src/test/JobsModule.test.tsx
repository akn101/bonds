import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JobsModule from "@/pages/contact/modules/JobsModule";

const apiMocks = vi.hoisted(() => ({
  companiesList: vi.fn(),
  companiesCreate: vi.fn(),
  jobsList: vi.fn(),
  jobsCreate: vi.fn(),
  jobsUpdate: vi.fn(),
  jobsDelete: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    companies: {
      companiesList: apiMocks.companiesList,
      companiesCreate: apiMocks.companiesCreate,
    },
    contacts: {
      contactsJobsList: apiMocks.jobsList,
      contactsJobsCreate: apiMocks.jobsCreate,
      contactsJobsUpdate: apiMocks.jobsUpdate,
      contactsJobsDelete: apiMocks.jobsDelete,
    },
  },
}));

function renderModule() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter>
            <JobsModule vaultId="vault-1" contactId="contact-1" />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

describe("JobsModule inline company creation", () => {
  beforeEach(() => {
    apiMocks.companiesList.mockReset();
    apiMocks.companiesCreate.mockReset();
    apiMocks.jobsList.mockReset();
    apiMocks.jobsCreate.mockReset();
    apiMocks.jobsUpdate.mockReset();
    apiMocks.jobsDelete.mockReset();
    apiMocks.companiesList.mockResolvedValue({ data: [] });
    apiMocks.jobsList.mockResolvedValue({ data: [] });
    apiMocks.jobsCreate.mockResolvedValue({ data: { id: 1 } });
  });

  it("creates a company before saving a job when the entered name is new", async () => {
    const user = userEvent.setup();
    apiMocks.companiesCreate.mockResolvedValue({
      data: { id: 42, name: "Acme", type: "employer" },
    });
    renderModule();

    await user.click((await screen.findByText("Add Job")).closest("button")!);
    await user.type(screen.getByRole("combobox", { name: "Company" }), "Acme");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.companiesCreate).toHaveBeenCalledWith("vault-1", {
        name: "Acme",
        type: "employer",
      }),
    );
    expect(apiMocks.jobsCreate).toHaveBeenCalledWith("vault-1", "contact-1", {
      company_id: 42,
      job_position: undefined,
    });
  });

  it("reuses an existing company without creating a duplicate", async () => {
    const user = userEvent.setup();
    apiMocks.companiesList.mockResolvedValue({
      data: [{ id: 7, name: "Existing Corp", type: "employer" }],
    });
    renderModule();

    await user.click((await screen.findByText("Add Job")).closest("button")!);
    await user.type(
      screen.getByRole("combobox", { name: "Company" }),
      "existing corp",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiMocks.jobsCreate).toHaveBeenCalled());
    expect(apiMocks.companiesCreate).not.toHaveBeenCalled();
    expect(apiMocks.jobsCreate).toHaveBeenCalledWith("vault-1", "contact-1", {
      company_id: 7,
      job_position: undefined,
    });
  });
});
