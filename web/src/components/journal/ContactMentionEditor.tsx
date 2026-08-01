import { useState } from "react";
import { Mentions, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { SearchResult } from "@/api";
import { serializeContactMention } from "@/components/journal/contactMentionSerialization";
import type { JournalContactReference } from "@/components/journal/contactMentionTypes";

const { Text } = Typography;

type ContactMentionEditorProps = {
  readonly vaultId: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onMentionSelect: (contact: JournalContactReference) => void;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly rows?: number;
  readonly showHint?: boolean;
};

function hasContactIdentity(
  contact: SearchResult,
): contact is SearchResult & { readonly id: string; readonly name: string } {
  return typeof contact.id === "string" && typeof contact.name === "string";
}

export default function ContactMentionEditor({
  vaultId,
  value,
  onChange,
  onMentionSelect,
  ariaLabel,
  placeholder,
  rows = 4,
  showHint = false,
}: ContactMentionEditorProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const { data: contacts = [], isFetching } = useQuery({
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
    enabled: searchTerm.length > 0,
  });
  const options = contacts.map((contact) => ({
    value: serializeContactMention(contact).optionValue,
    label: contact.name,
  }));

  return (
    <div>
      <Mentions
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        onSearch={setSearchTerm}
        onSelect={(option) => {
          const contact = contacts.find(
            (candidate) =>
              serializeContactMention(candidate).optionValue === option.value,
          );
          if (contact) onMentionSelect(contact);
        }}
        options={options}
        filterOption={false}
        loading={isFetching}
        placeholder={placeholder}
        rows={rows}
        split=" "
      />
      {showHint && (
        <Text
          type="secondary"
          style={{ display: "block", marginTop: 4, fontSize: 12 }}
        >
          {t("vault.journal_mentions.mention_hint")}
        </Text>
      )}
    </div>
  );
}
