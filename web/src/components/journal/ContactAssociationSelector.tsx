import { useMemo, useState } from "react";
import { Checkbox, Select, Space } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { SearchResult } from "@/api";
import type { JournalContactReference } from "@/components/journal/contactMentionTypes";

type ContactAssociationSelectorProps = {
  readonly vaultId: string;
  readonly contacts: readonly JournalContactReference[];
  readonly updateLastContacted: boolean;
  readonly onContactsChange: (contacts: JournalContactReference[]) => void;
  readonly onUpdateLastContactedChange: (checked: boolean) => void;
};

function hasContactIdentity(
  contact: SearchResult,
): contact is SearchResult & { readonly id: string; readonly name: string } {
  return typeof contact.id === "string" && typeof contact.name === "string";
}

export default function ContactAssociationSelector({
  vaultId,
  contacts,
  updateLastContacted,
  onContactsChange,
  onUpdateLastContactedChange,
}: ContactAssociationSelectorProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const { data: searchResults = [], isFetching } = useQuery({
    queryKey: [
      "vaults",
      vaultId,
      "contacts",
      "selectable-contacts",
      searchTerm,
    ],
    queryFn: async (): Promise<JournalContactReference[]> => {
      const response = await api.contacts.contactsSelectableList(vaultId, {
        search: searchTerm,
      });
      return (response.data ?? [])
        .filter((contact: SearchResult) => hasContactIdentity(contact))
        .map(
          (
            contact: SearchResult & {
              readonly id: string;
              readonly name: string;
            },
          ) => ({
            id: contact.id,
            name: contact.name,
          }),
        );
    },
  });
  const availableContacts = useMemo(() => {
    const contactsById = new Map(
      searchResults.map((contact) => [contact.id, contact]),
    );
    for (const contact of contacts) contactsById.set(contact.id, contact);
    return Array.from(contactsById.values());
  }, [contacts, searchResults]);

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Select
        aria-label={t("vault.journal_mentions.contacts_label")}
        mode="multiple"
        allowClear
        showSearch
        filterOption={false}
        loading={isFetching}
        value={contacts.map((contact) => contact.id)}
        onSearch={setSearchTerm}
        onChange={(contactIds) => {
          const nextContacts = contactIds.flatMap((contactId) => {
            const contact = availableContacts.find(
              (candidate) => candidate.id === contactId,
            );
            return contact ? [contact] : [];
          });
          onContactsChange(nextContacts);
          if (nextContacts.length === 0) onUpdateLastContactedChange(false);
        }}
        options={availableContacts.map((contact) => ({
          label: contact.name,
          value: contact.id,
        }))}
        placeholder={t("vault.journal_mentions.contacts_placeholder")}
        style={{ width: "100%" }}
      />
      <Checkbox
        checked={updateLastContacted}
        disabled={contacts.length === 0}
        onChange={(event) => onUpdateLastContactedChange(event.target.checked)}
      >
        {t("vault.journal_mentions.update_last_contacted")}
      </Checkbox>
    </Space>
  );
}
