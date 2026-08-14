import { Space, Tag } from "antd";
import { Link } from "react-router-dom";
import type { PostContactReference } from "@/components/journal/contactMentionTypes";
import { formatContactName, useNameOrder } from "@/utils/nameFormat";

type PostContactTagsProps = {
  readonly vaultId: string;
  readonly contacts: readonly PostContactReference[];
};

export default function PostContactTags({
  vaultId,
  contacts,
}: PostContactTagsProps) {
  const nameOrder = useNameOrder();
  const linkedContacts = contacts.filter(
    (contact): contact is PostContactReference & { readonly id: string } =>
      typeof contact.id === "string",
  );
  if (linkedContacts.length === 0) return null;

  return (
    <Space size={[0, 4]} wrap>
      {linkedContacts.map((contact) => (
        <Tag key={contact.id} color="blue">
          <Link
            to={`/vaults/${vaultId}/contacts/${contact.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            {formatContactName(nameOrder, contact)}
          </Link>
        </Tag>
      ))}
    </Space>
  );
}
