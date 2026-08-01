import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import {
  apiMock,
  renderRelationshipsModule,
  setupRelationshipsUser,
} from "./relationshipsModuleTestHarness";

describe("RelationshipsModule characterization", () => {
  it("submits the selected existing contact and relationship type", async () => {
    const user = setupRelationshipsUser();
    renderRelationshipsModule();

    await user.click(await screen.findByText("Add"));
    await user.click(await screen.findByLabelText(/^Contact$/i));
    await user.click(await screen.findByTitle("Jane Doe"));
    await user.click(screen.getByLabelText(/^Relationship Type$/i));
    await user.click(await screen.findByTitle("Parent"));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsCreate).toHaveBeenCalledWith(
        "v1",
        "c1",
        {
          relationship_type_id: 10,
          related_contact_id: "existing-uuid",
        },
      );
    });
  });

  it("submits an external contact without a related contact id", async () => {
    const user = setupRelationshipsUser();
    renderRelationshipsModule();

    await user.click(await screen.findByText("Add"));
    await user.click(await screen.findByText(/External contact/i));
    await user.type(
      await screen.findByRole("textbox", { name: /External/i }),
      "  Uncle Bob  ",
    );
    await user.click(screen.getByLabelText(/^Relationship Type$/i));
    await user.click(await screen.findByTitle("Parent"));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsCreate).toHaveBeenCalledWith(
        "v1",
        "c1",
        {
          relationship_type_id: 10,
          external_contact_name: "Uncle Bob",
        },
      );
    });
  });

  it("updates only the related contact and relationship type", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 22,
          related_contact_id: "existing-uuid",
          related_contact_name: "Jane Doe",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    renderRelationshipsModule();

    await user.click(await screen.findByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsUpdate).toHaveBeenCalledWith(
        "v1",
        "c1",
        22,
        {
          related_contact_id: "existing-uuid",
          relationship_type_id: 10,
        },
      );
    });
  });

  it("renders a hidden relationship contact by name with the current-vault fallback link", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 23,
          related_contact_id: "hidden-external-uuid",
          related_contact_name: "Aunt Mary",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    renderRelationshipsModule();

    const contactLink = await screen.findByRole("link", { name: "Aunt Mary" });
    expect(contactLink).toHaveAttribute(
      "href",
      "/vaults/v1/contacts/hidden-external-uuid",
    );
    await user.click(screen.getByRole("button", { name: "edit" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Aunt Mary")).toBeInTheDocument();
    expect(
      within(dialog).queryByText("hidden-external-uuid"),
    ).not.toBeInTheDocument();
  });

  it("keeps the relationship source marker for feed deep links", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 24,
          related_contact_id: "existing-uuid",
          related_contact_name: "Jane Doe",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });

    renderRelationshipsModule({
      target: { id: 24, kind: "Relationship", module: "relationships" },
    });

    const markedRecord = (await screen.findByText("Jane Doe")).closest(
      '[data-source-record="Relationship:24"]',
    );
    expect(markedRecord).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("shows relationship direction guidance with dynamic contact names", async () => {
    const user = setupRelationshipsUser();
    renderRelationshipsModule();

    await user.click(await screen.findByText("Add"));
    await user.click(await screen.findByLabelText(/^Contact$/i));
    await user.click(await screen.findByTitle("Jane Doe"));
    await user.click(screen.getByLabelText(/^Relationship Type$/i));
    await user.click(await screen.findByTitle("Parent"));

    expect(
      await screen.findByText(/Alice Johnson is the Parent of Jane Doe\./i),
    ).toBeInTheDocument();
  });

  it("shows the one-way hint for a viewer-only selected contact", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "viewer-only-uuid",
          contact_name: "Viewer Vault Contact",
          vault_id: "v2",
          vault_name: "Shared",
          has_editor: false,
        },
      ],
    });
    renderRelationshipsModule();

    await user.click(await screen.findByText("Add"));
    await user.click(await screen.findByLabelText(/^Contact$/i));
    await user.click(
      await screen.findByTitle(/Viewer Vault Contact.*one-way only/i),
    );

    expect(
      await screen.findByText(/Only a one-way relationship will be created\./i),
    ).toBeInTheDocument();
  });
});
