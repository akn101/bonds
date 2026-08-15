import { Empty, Typography } from "antd";
import { Link } from "react-router-dom";
import ContactAvatar from "@/components/ContactAvatar";
import type { PostContactReference } from "@/components/journal/contactMentionTypes";
import { formatContactName, useNameOrder } from "@/utils/nameFormat";

const { Text } = Typography;

type ContactReferenceListProps = {
  readonly vaultId: string;
  readonly contacts: readonly PostContactReference[];
  readonly emptyText: string;
};

export default function ContactReferenceList({
  vaultId,
  contacts,
  emptyText,
}: ContactReferenceListProps) {
  const nameOrder = useNameOrder();
  const linkableContacts = contacts.filter(
    (contact): contact is PostContactReference & { id: string } =>
      typeof contact.id === "string" && contact.id.length > 0,
  );
  if (linkableContacts.length === 0) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    );
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {linkableContacts.map((contact) => {
        const name = contact.name || formatContactName(nameOrder, contact);
        return (
          <li key={contact.id} style={{ padding: "8px 0" }}>
            <Link
              to={`/vaults/${vaultId}/contacts/${contact.id}`}
              aria-label={name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
              }}
            >
              <ContactAvatar
                vaultId={vaultId}
                contactId={contact.id}
                firstName={contact.first_name}
                lastName={contact.last_name}
                size={36}
              />
              <span>
                <Text strong>{name}</Text>
                {contact.job_position && (
                  <Text type="secondary" style={{ display: "block" }}>
                    {contact.job_position}
                  </Text>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
