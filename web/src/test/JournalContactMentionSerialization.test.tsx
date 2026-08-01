import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ContactMentionEditor from "@/components/journal/ContactMentionEditor";
import {
  parseContactMentions,
  serializeContactMention,
} from "@/components/journal/contactMentionSerialization";
import type { JournalContactReference } from "@/components/journal/contactMentionTypes";

const CONTACT_ID = "550e8400-e29b-41d4-a716-446655440000";
const mockSelectableContacts = vi.fn();

vi.mock("@/api", () => ({
  api: {
    contacts: {
      contactsSelectableList: (...args: unknown[]) =>
        mockSelectableContacts(...args),
    },
  },
}));

function ContactMentionEditorFixture({
  onMentionSelect,
}: {
  readonly onMentionSelect: (contact: JournalContactReference) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <ContactMentionEditor
      vaultId="v1"
      value={value}
      onChange={setValue}
      onMentionSelect={onMentionSelect}
      ariaLabel="Mention contact"
      placeholder="Write a mention"
    />
  );
}

describe("journal contact mention serialization", () => {
  it("serializes a closing bracket into the marker inserted by the editor", async () => {
    const contact = { id: CONTACT_ID, name: "Research ] Team" };
    mockSelectableContacts.mockResolvedValue({ data: [contact] });
    const onMentionSelect = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <AntApp>
            <ContactMentionEditorFixture onMentionSelect={onMentionSelect} />
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const editor = screen.getByRole("textbox", { name: "Mention contact" });

    await user.type(editor, "@research");
    await user.click(await screen.findByText(contact.name));

    expect(editor).toHaveValue(`@[Research \\] Team](contact:${CONTACT_ID}) `);
    expect(onMentionSelect).toHaveBeenCalledWith(contact);
  });

  it("round-trips a closing bracket in a contact display name", () => {
    const serializedMention = serializeContactMention({
      id: CONTACT_ID,
      name: "Research ] Team",
    });

    expect(serializedMention.marker).toBe(
      `@[Research \\] Team](contact:${CONTACT_ID})`,
    );
    expect(parseContactMentions(serializedMention.marker)).toEqual([
      {
        marker: serializedMention.marker,
        displayName: "Research ] Team",
        contactId: CONTACT_ID,
        index: 0,
      },
    ]);
  });

  it("round-trips backslashes in a contact display name", () => {
    const serializedMention = serializeContactMention({
      id: CONTACT_ID,
      name: "Research \\ Team",
    });

    expect(serializedMention.marker).toBe(
      `@[Research \\\\ Team](contact:${CONTACT_ID})`,
    );
    expect(parseContactMentions(serializedMention.marker)[0]?.displayName).toBe(
      "Research \\ Team",
    );
  });

  it("normalizes carriage returns and newlines to spaces", () => {
    const serializedMention = serializeContactMention({
      id: CONTACT_ID,
      name: "Research\r\nLine\nBreak\rTeam",
    });

    expect(serializedMention.marker).toBe(
      `@[Research Line Break Team](contact:${CONTACT_ID})`,
    );
    expect(serializedMention.marker).not.toMatch(/[\r\n]/);
    expect(parseContactMentions(serializedMention.marker)[0]?.displayName).toBe(
      "Research Line Break Team",
    );
  });
});
