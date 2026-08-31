import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { Alert, Empty, Table, Tag, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { formatDate, useDateFormat } from "@/utils/dateFormat";
import type { InteractionContactItem, InteractionsReportResponse } from "@/api";
import { useElementWidth } from "@/hooks/useElementWidth";

const { Text } = Typography;

type Props = {
  report?: InteractionsReportResponse;
  onSelectContact?: (contactId: string) => void;
  height?: number;
};

/**
 * One month of the chart: the period plus a count per channel, keyed c0, c1…
 * The value type is loose because d3.stack reads the channel keys off the same
 * object the period lives on.
 */
type MonthRow = Record<string, string | number>;

/** Fallback series colours for activity types that have none set. */
const FALLBACK_COLORS = ["#1677ff", "#722ed1", "#52c41a", "#fa8c16", "#eb2f96", "#13c2c2"];

export default function InteractionCadence({ report, onSelectContact, height = 220 }: Props) {
  const { t } = useTranslation();
  const dateFormats = useDateFormat();
  const { token } = theme.useToken();
  const svgRef = useRef<SVGSVGElement>(null);
  const { ref: containerRef, width } = useElementWidth();

  const channels = useMemo(() => report?.channels ?? [], [report]);
  const months = useMemo(() => report?.months ?? [], [report]);

  // One row per month with a column per channel, which is the shape d3.stack
  // wants and also the shape a reader would tabulate it in.
  const stackData = useMemo<MonthRow[]>(() => {
    return months.map((month, index) => {
      const row: MonthRow = { period: month.period ?? "" };
      channels.forEach((channel, channelIndex) => {
        row[`c${channelIndex}`] = channel.months?.[index]?.count ?? 0;
      });
      return row;
    });
  }, [months, channels]);

  const colorFor = (index: number) => channels[index]?.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];

  useEffect(() => {
    if (!svgRef.current || width <= 0 || stackData.length === 0 || channels.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const margin = { top: 8, right: 4, bottom: 20, left: 32 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);
    const root = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const keys = channels.map((_, index) => `c${index}`);
    const series = d3
      .stack<MonthRow>()
      .keys(keys)
      .value((row, key) => Number(row[key] ?? 0))(stackData);
    const maxTotal = d3.max(stackData, (row) => keys.reduce((sum, key) => sum + Number(row[key] ?? 0), 0)) ?? 0;

    const x = d3
      .scaleBand<string>()
      .domain(stackData.map((row) => String(row.period)))
      .range([0, innerWidth])
      .padding(0.2);
    const y = d3.scaleLinear().domain([0, Math.max(1, maxTotal)]).nice().range([innerHeight, 0]);

    root
      .append("g")
      .call(d3.axisLeft(y).ticks(4).tickSize(-innerWidth))
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll(".tick line").attr("stroke", token.colorBorderSecondary).attr("stroke-opacity", 0.6))
      .call((g) => g.selectAll(".tick text").attr("fill", token.colorTextTertiary).attr("font-size", 10));

    // Only every Nth month is labelled: a two-year window has 24 buckets and
    // they will not fit side by side on a phone.
    const step = Math.max(1, Math.ceil(stackData.length / (width < 480 ? 4 : 8)));
    root
      .append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(stackData.map((row) => String(row.period)).filter((_, index) => index % step === 0))
          .tickSize(0)
          .tickPadding(6),
      )
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll(".tick text").attr("fill", token.colorTextTertiary).attr("font-size", 10));

    root
      .append("g")
      .selectAll("g")
      .data(series)
      .join("g")
      .attr("fill", (_, index) => colorFor(index))
      .selectAll("rect")
      .data((layer) => layer)
      .join("rect")
      .attr("x", (segment) => x(String(segment.data.period)) ?? 0)
      .attr("y", (segment) => y(segment[1]))
      .attr("height", (segment) => Math.max(0, y(segment[0]) - y(segment[1])))
      .attr("width", x.bandwidth())
      .append("title")
      .text((segment) => `${String(segment.data.period)}: ${Math.round(segment[1] - segment[0])}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stackData,
    channels,
    width,
    height,
    token.colorBorderSecondary,
    token.colorTextTertiary,
  ]);

  if (!report) {
    return <Empty description={t("vault.reports.interactions.no_data")} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const totalInteractions = report.total_interactions ?? 0;
  const totalActivities = report.total_activities ?? 0;

  // A vault can be full of activities and still have no interactions, because
  // whether a type counts is a per-type setting. Saying so is far more useful
  // than an empty chart.
  if (totalInteractions === 0) {
    return totalActivities > 0 ? (
      <Alert
        type="info"
        showIcon
        message={t("vault.reports.interactions.not_flagged_title")}
        description={t("vault.reports.interactions.not_flagged_body", { count: totalActivities })}
      />
    ) : (
      <Empty description={t("vault.reports.interactions.no_data")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
    );
  }

  const nameColumn = {
    title: t("vault.reports.col_contact"),
    key: "contact",
    render: (_: unknown, item: InteractionContactItem) => (
      <a onClick={() => item.contact_id && onSelectContact?.(item.contact_id)}>{item.contact_name}</a>
    ),
  };
  // Dates go through the shared formatter so they follow the reader's
  // configured format, like every other date in the app.
  const formatLastSeen = (value?: string) => (value ? formatDate(value, dateFormats) : "—");

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%" }}>
        <svg ref={svgRef} role="img" aria-label={t("vault.reports.interactions.chart_aria")} style={{ width: "100%", height }} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "8px 0 20px" }}>
        {channels.map((channel, index) => (
          <span key={channel.activity_type_id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colorFor(index) }} />
            <Text style={{ fontSize: 13 }}>{channel.label}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {channel.count}
            </Text>
          </span>
        ))}
      </div>

      <Text strong style={{ display: "block", marginBottom: 8 }}>
        {t("vault.reports.interactions.most_frequent")}
      </Text>
      <Table
        dataSource={report.most_frequent ?? []}
        rowKey={(item) => item.contact_id ?? ""}
        pagination={false}
        size="small"
        style={{ marginBottom: 24 }}
        columns={[
          nameColumn,
          {
            title: t("vault.reports.interactions.col_occasions"),
            dataIndex: "count",
            key: "count",
          },
          {
            title: t("vault.reports.interactions.col_rhythm"),
            key: "rhythm",
            render: (_: unknown, item: InteractionContactItem) =>
              item.median_gap_days != null
                ? t("vault.reports.interactions.every_n_days", { count: item.median_gap_days })
                : "—",
          },
          {
            title: t("vault.reports.interactions.col_last"),
            key: "last",
            render: (_: unknown, item: InteractionContactItem) => formatLastSeen(item.last_at),
          },
        ]}
      />

      <Text strong style={{ display: "block", marginBottom: 4 }}>
        {t("vault.reports.interactions.gone_quiet")}
      </Text>
      <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        {t("vault.reports.interactions.gone_quiet_hint")}
      </Text>
      {(report.gone_quiet ?? []).length === 0 ? (
        <Empty description={t("vault.reports.interactions.nobody_quiet")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          dataSource={report.gone_quiet ?? []}
          rowKey={(item) => item.contact_id ?? ""}
          pagination={false}
          size="small"
          columns={[
            nameColumn,
            {
              title: t("vault.reports.interactions.col_silent_for"),
              key: "silence",
              render: (_: unknown, item: InteractionContactItem) => (
                <Tag color="orange">
                  {t("vault.reports.interactions.days_ago", { count: item.days_since_last ?? 0 })}
                </Tag>
              ),
            },
            {
              title: t("vault.reports.interactions.col_rhythm"),
              key: "rhythm",
              render: (_: unknown, item: InteractionContactItem) =>
                item.median_gap_days != null
                  ? t("vault.reports.interactions.every_n_days", { count: item.median_gap_days })
                  : "—",
            },
            {
              title: t("vault.reports.interactions.col_last"),
              key: "last",
              render: (_: unknown, item: InteractionContactItem) => formatLastSeen(item.last_at),
            },
          ]}
        />
      )}
    </div>
  );
}
