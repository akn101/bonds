import { useMemo } from "react";
import { Empty, Progress, Segmented, Skeleton, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type { DemographicDimension, DemographicsReportResponse } from "@/api";

const { Text } = Typography;

// Age bands come back as stable keys rather than rendered ranges so the server
// never has to know the reader's language.
const AGE_BAND_KEYS = ["0_17", "18_24", "25_34", "35_44", "45_54", "55_64", "65_plus"];

type Props = {
  report?: DemographicsReportResponse;
  /** True while the report is being fetched, so absent data is not mistaken for an empty vault. */
  loading?: boolean;
};

export default function DemographicsPanel({ report, loading = false }: Props) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const dimensions = useMemo(
    () => (report?.dimensions ?? []).filter((d): d is DemographicDimension => !!d.key),
    [report],
  );
  const [selected, setSelected] = useState<string | undefined>(undefined);

  if (!report || dimensions.length === 0) {
    return loading ? <Skeleton active /> : <Empty description={t("vault.reports.demographics.no_data")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  // Open on a dimension that has data. Gender comes first in the list and is
  // empty in most vaults, and a panel that opens on "nobody has this recorded"
  // reads as broken rather than as informative.
  const firstPopulated = dimensions.find((d) => (d.buckets ?? []).length > 0);
  const active =
    dimensions.find((d) => d.key === selected) ?? firstPopulated ?? dimensions[0];
  const total = report.total_contacts ?? 0;
  const known = active.known ?? 0;
  const buckets = active.buckets ?? [];
  // Bars are measured against the largest bucket, not against the whole address
  // book, or a vault where every dimension is sparsely filled draws seven
  // invisible slivers.
  const largest = Math.max(1, ...buckets.map((b) => b.count ?? 0));

  const bucketLabel = (value?: string, label?: string) => {
    if (active.key === "age" && value && AGE_BAND_KEYS.includes(value)) {
      return t(`vault.reports.demographics.age.${value}`);
    }
    return label || t("vault.reports.demographics.unnamed");
  };

  return (
    <div>
      <Segmented
        aria-label={t("vault.reports.demographics.dimension_label")}
        value={active.key}
        onChange={(value) => setSelected(String(value))}
        options={dimensions.map((dimension) => ({
          label: t(`vault.reports.demographics.dimension.${dimension.key}`),
          value: dimension.key!,
        }))}
        style={{ marginBottom: 16, maxWidth: "100%", overflowX: "auto" }}
      />

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t("vault.reports.demographics.coverage", { known, total })}
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t("vault.reports.demographics.not_set", { count: active.unset ?? 0 })}
          </Text>
        </div>
        {/* Coverage is the headline for most vaults: an address book imported
            from a phone has almost none of these fields filled in. */}
        <Progress
          percent={total > 0 ? Math.round((known / total) * 100) : 0}
          showInfo={false}
          strokeColor={token.colorPrimary}
          size="small"
        />
      </div>

      {buckets.length === 0 ? (
        <Empty description={t("vault.reports.demographics.dimension_empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {buckets.map((bucket) => {
            const count = bucket.count ?? 0;
            const share = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={bucket.value}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text style={{ fontSize: 14 }}>{bucketLabel(bucket.value, bucket.label)}</Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {count} ({share}%)
                  </Text>
                </div>
                <div
                  style={{
                    height: 8,
                    width: "100%",
                    backgroundColor: token.colorFillSecondary,
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((count / largest) * 100)}%`,
                      backgroundColor: token.colorPrimary,
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
