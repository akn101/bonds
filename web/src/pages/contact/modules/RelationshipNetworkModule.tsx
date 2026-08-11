import { Card } from "antd";
import { useTranslation } from "react-i18next";
import NetworkGraph from "@/components/NetworkGraph";

interface RelationshipNetworkModuleProps {
  readonly vaultId: string;
  readonly contactId: string;
}

export default function RelationshipNetworkModule({
  vaultId,
  contactId,
}: RelationshipNetworkModuleProps) {
  const { t } = useTranslation();

  return (
    <Card title={t("contact.detail.summary.network")}>
      <NetworkGraph vaultId={vaultId} contactId={contactId} />
    </Card>
  );
}
