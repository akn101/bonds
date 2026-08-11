import type { Contact } from "@/api";
import ContactSummaryCard from "./ContactSummaryCard";

interface ContactSummaryModuleProps {
  readonly vaultId: string;
  readonly contactId: string;
  readonly contact?: Contact;
}

export default function ContactSummaryModule({
  vaultId,
  contactId,
  contact,
}: ContactSummaryModuleProps) {
  if (!contact) return null;

  return (
    <ContactSummaryCard
      vaultId={vaultId}
      contactId={contactId}
      contact={contact}
      readOnly
    />
  );
}
