import type { ReactNode } from "react";
import { Popover, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ContactAvatar from "@/components/ContactAvatar";
import LinkifiedText from "@/components/LinkifiedText";
import { parseContactMentions } from "@/components/journal/contactMentionSerialization";
import type { PostContactReference } from "@/components/journal/contactMentionTypes";
import { formatContactName, useVaultNameOrder } from "@/utils/nameFormat";
import { formatDateOnly } from "@/utils/dateOnlyInput";
import { useDateFormat } from "@/utils/dateFormat";

const { Text } = Typography;

type ContactMentionTextProps = {
  readonly vaultId: string;
  readonly contacts: readonly PostContactReference[];
  readonly children: string;
};

type ContactMentionLinkProps = {
  readonly vaultId: string;
  readonly contact: PostContactReference & { readonly id: string };
  readonly name: string;
};

function ContactMentionLink({
  vaultId,
  contact,
  name,
}: ContactMentionLinkProps) {
  const { t } = useTranslation();
  const dateFormats = useDateFormat();
  const path = `/vaults/${vaultId}/contacts/${contact.id}`;
  const lastTalkedTo = formatDateOnly(contact.last_talked_to, dateFormats);
  return (
    <Popover
      trigger={["hover", "focus"]}
      content={
        <Link
          to={path}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${t("vault.journal_mentions.view_contact")}: ${name}`}
          style={{ display: "block", minWidth: 220, color: "inherit" }}
        >
          <Space size={12} align="start">
            <ContactAvatar
              vaultId={vaultId}
              contactId={contact.id}
              firstName={contact.first_name}
              lastName={contact.last_name}
              size={44}
            />
            <div>
              <Text strong style={{ display: "block" }}>
                {name}
              </Text>
              {contact.nickname && (
                <Text type="secondary" style={{ display: "block" }}>
                  {t("contact.detail.nickname")}: {contact.nickname}
                </Text>
              )}
              {contact.job_position && (
                <Text type="secondary" style={{ display: "block" }}>
                  {t("contact.detail.job_position")}: {contact.job_position}
                </Text>
              )}
              {lastTalkedTo && (
                <Text type="secondary" style={{ display: "block" }}>
                  {t("contact.catch_up.last_contact_summary", {
                    date: lastTalkedTo,
                  })}
                </Text>
              )}
              <Text style={{ display: "block", marginTop: 4, fontSize: 12 }}>
                {t("vault.journal_mentions.view_contact")} →
              </Text>
            </div>
          </Space>
        </Link>
      }
    >
      <Link to={path} onClick={(event) => event.stopPropagation()}>
        {name}
      </Link>
    </Popover>
  );
}

export default function ContactMentionText({
  vaultId,
  contacts,
  children,
}: ContactMentionTextProps) {
  const nameOrder = useVaultNameOrder(vaultId);
  const contactsById = new Map(
    contacts.flatMap((contact) =>
      contact.id ? [[contact.id.toLowerCase(), contact]] : [],
    ),
  );
  const content: ReactNode[] = [];
  const renderedContactIds = new Set<string>();
  let textStart = 0;

  for (const mention of parseContactMentions(children)) {
    const matchStart = mention.index;
    if (matchStart > textStart) {
      content.push(
        <LinkifiedText key={`text-${textStart}`}>
          {children.slice(textStart, matchStart)}
        </LinkifiedText>,
      );
    }
    const contact = contactsById.get(mention.contactId.toLowerCase());
    if (contact?.id) renderedContactIds.add(contact.id.toLowerCase());
    content.push(
      contact?.id ? (
        <ContactMentionLink
          key={`contact-${matchStart}`}
          vaultId={vaultId}
          contact={{ ...contact, id: contact.id }}
          name={contact.name || formatContactName(nameOrder, contact)}
        />
      ) : (
        <LinkifiedText key={`text-${matchStart}`}>
          {mention.displayName}
        </LinkifiedText>
      ),
    );
    textStart = matchStart + mention.marker.length;
  }
  if (textStart < children.length) {
    content.push(
      <LinkifiedText key={`text-${textStart}`}>
        {children.slice(textStart)}
      </LinkifiedText>,
    );
  }
  // Associations are authoritative. Legacy entries and partially edited text
  // can contain an associated contact without an inline marker; keep those
  // people visible and navigable instead of silently losing the relationship.
  for (const contact of contacts) {
    if (!contact.id || renderedContactIds.has(contact.id.toLowerCase()))
      continue;
    const name = contact.name || formatContactName(nameOrder, contact);
    content.push(" ");
    content.push(
      <ContactMentionLink
        key={`fallback-contact-${contact.id}`}
        vaultId={vaultId}
        contact={{ ...contact, id: contact.id }}
        name={`@${name}`}
      />,
    );
  }
  return <>{content}</>;
}
