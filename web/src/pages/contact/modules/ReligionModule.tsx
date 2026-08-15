import { useState } from "react";
import { App, Button, Card, Form, Modal, Select, Typography } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type {
  APIError,
  Contact,
  PersonalizeItem,
  UpdateContactReligionRequest,
} from "@/api";

const { Title, Text } = Typography;

type ReligionModuleProps = {
  readonly vaultId: string;
  readonly contactId: string;
  readonly contact: Contact;
};

export default function ReligionModule({
  vaultId,
  contactId,
  contact,
}: ReligionModuleProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<UpdateContactReligionRequest>();

  const { data: religions = [] } = useQuery<PersonalizeItem[]>({
    queryKey: ["vaults", vaultId, "personalize", "religions"],
    queryFn: async () =>
      (await api.personalize.personalizeDetail("religions")).data ?? [],
  });

  const mutation = useMutation({
    mutationFn: (values: UpdateContactReligionRequest) =>
      api.contacts.contactsReligionUpdate(vaultId, contactId, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["vaults", vaultId, "contacts", contactId],
      });
      message.success(t("common.updated"));
      setOpen(false);
    },
    onError: (error: APIError) =>
      message.error(error.message || t("common.error")),
  });

  const religion = religions.find((item) => item.id === contact.religion_id);

  return (
    <Card
      title={
        <Title level={5} style={{ margin: 0 }}>
          {t("contact.detail.religion")}
        </Title>
      }
      extra={
        <Button
          type="text"
          icon={<EditOutlined />}
          onClick={() => {
            form.setFieldsValue({ religion_id: contact.religion_id });
            setOpen(true);
          }}
        >
          {t("common.edit")}
        </Button>
      }
    >
      {contact.religion_id ? (
        <Text>{religion?.label || contact.religion_id}</Text>
      ) : (
        <Text type="secondary">{t("contact.detail.no_religion")}</Text>
      )}

      <Modal
        title={t("contact.detail.religion")}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => mutation.mutate(values)}
        >
          <Form.Item name="religion_id" label={t("contact.detail.religion")}>
            <Select
              allowClear
              options={religions.map((item) => ({
                label: item.label,
                value: item.id,
              }))}
              placeholder={t("contact.detail.labels.select_placeholder")}
            />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
            >
              {t("common.save")}
            </Button>
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
