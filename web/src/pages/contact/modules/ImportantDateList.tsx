import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Empty, List, Popconfirm, Tag, theme } from "antd";
import { useTranslation } from "react-i18next";
import type { ImportantDate, ImportantDateTypeResponse } from "@/api";
import type { DateFormatVariants } from "@/utils/dateFormat";
import {
  computeAgeAtImportantDate,
  computeImportantDateAge,
  formatImportantDateDisplay,
} from "@/utils/importantDateDisplay";

type ImportantDateListProps = {
  readonly dates: ImportantDate[];
  readonly dateTypes: ImportantDateTypeResponse[];
  readonly isLoading: boolean;
  readonly alternativeCalendarEnabled: boolean;
  readonly dateFormats: DateFormatVariants;
  readonly onEdit: (date: ImportantDate) => void;
  readonly onDelete: (id: number) => void;
};

export default function ImportantDateList({
  dates,
  dateTypes,
  isLoading,
  alternativeCalendarEnabled,
  dateFormats,
  onEdit,
  onDelete,
}: ImportantDateListProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const findByInternalType = (
    internalType: string,
  ): ImportantDate | undefined =>
    dates.find((date) => {
      const dateType = dateTypes.find(
        (candidate) => candidate.id === date.contact_important_date_type_id,
      );
      return dateType?.internal_type === internalType;
    });
  const birthDate = findByInternalType("birthdate");
  const deceasedDate = findByInternalType("deceased_date");

  return (
    <List
      loading={isLoading}
      dataSource={dates}
      locale={{
        emptyText: (
          <Empty description={t("modules.important_dates.no_dates")} />
        ),
      }}
      split={false}
      renderItem={(date: ImportantDate) => {
        const matchedType = dateTypes.find(
          (dateType) => dateType.id === date.contact_important_date_type_id,
        );
        const isBirthday = matchedType?.internal_type === "birthdate";
        const isDeceasedItem = matchedType?.internal_type === "deceased_date";
        let age: number | null = null;
        if (isBirthday && deceasedDate === undefined) {
          age = computeImportantDateAge(date);
        } else if (isDeceasedItem) {
          age = computeAgeAtImportantDate(birthDate, deceasedDate);
        }

        return (
          <List.Item
            style={{
              borderRadius: token.borderRadius,
              padding: "10px 12px",
              marginBottom: 4,
              transition: "background 0.2s",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = token.colorFillQuaternary;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
            }}
            actions={[
              <Button
                key="edit"
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => onEdit(date)}
              />,
              <Popconfirm
                key="delete"
                title={t("modules.important_dates.delete_confirm")}
                onConfirm={() => {
                  if (date.id !== undefined) {
                    onDelete(date.id);
                  }
                }}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <span style={{ fontWeight: 500 }}>
                  {date.label}
                  {age !== null && (
                    <Tag style={{ marginLeft: 8 }}>
                      {t("modules.important_dates.age_years", { count: age })}
                    </Tag>
                  )}
                </span>
              }
              description={
                <>
                  <span style={{ color: token.colorTextSecondary }}>
                    {formatImportantDateDisplay(date, dateFormats)}
                  </span>{" "}
                  {alternativeCalendarEnabled &&
                    date.calendar_type &&
                    date.calendar_type !== "gregorian" && (
                      <Tag color="volcano">{date.calendar_type}</Tag>
                    )}
                </>
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
