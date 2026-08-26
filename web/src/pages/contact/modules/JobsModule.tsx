import { useState } from "react";
import {
  App,
  AutoComplete,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { Company, ContactJob } from "@/api";

const { Text, Title } = Typography;

type JobFormValues = {
  company_name: string;
  job_position?: string;
};

type ResolvedJobFormValues = {
  company_id: number;
  job_position?: string;
};

type JobsModuleProps = {
  readonly vaultId: string;
  readonly contactId: string;
};

export default function JobsModule({ vaultId, contactId }: JobsModuleProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ContactJob | null>(null);
  const [form] = Form.useForm<JobFormValues>();
  const jobsQueryKey = ["vaults", vaultId, "contacts", contactId, "jobs"];

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["vaults", vaultId, "companies"],
    queryFn: async () =>
      (await api.companies.companiesList(vaultId)).data ?? [],
  });
  const { data: jobs = [] } = useQuery<ContactJob[]>({
    queryKey: jobsQueryKey,
    queryFn: async () =>
      (await api.contacts.contactsJobsList(vaultId, contactId)).data ?? [],
  });

  const finishMutation = async (successKey: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: jobsQueryKey }),
      queryClient.invalidateQueries({
        queryKey: ["vaults", vaultId, "companies"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["vaults", vaultId, "contacts", contactId],
      }),
    ]);
    message.success(t(successKey));
    setOpen(false);
    setEditingJob(null);
    form.resetFields();
  };
  const onError = (error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message !== ""
    ) {
      message.error(error.message);
      return;
    }
    message.error(t("common.error"));
  };

  const resolveJobValues = async (
    values: JobFormValues,
  ): Promise<ResolvedJobFormValues> => {
    const companyName = values.company_name.trim();
    const existing = companies.find(
      (company) =>
        company.name?.trim().toLocaleLowerCase() ===
        companyName.toLocaleLowerCase(),
    );
    if (existing?.id != null) {
      return { company_id: existing.id, job_position: values.job_position };
    }

    const created = await api.companies.companiesCreate(vaultId, {
      name: companyName,
      type: "employer",
    });
    if (created.data?.id == null) {
      throw new Error(t("contact.detail.company_create_failed"));
    }
    return {
      company_id: created.data.id,
      job_position: values.job_position,
    };
  };

  const createMutation = useMutation({
    mutationFn: async (values: JobFormValues) =>
      api.contacts.contactsJobsCreate(
        vaultId,
        contactId,
        await resolveJobValues(values),
      ),
    onSuccess: () => finishMutation("contact.detail.job_added"),
    onError,
  });
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: JobFormValues }) =>
      api.contacts.contactsJobsUpdate(
        vaultId,
        contactId,
        id,
        await resolveJobValues(values),
      ),
    onSuccess: () => finishMutation("contact.detail.job_updated"),
    onError,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      api.contacts.contactsJobsDelete(vaultId, contactId, id),
    onSuccess: () => finishMutation("contact.detail.job_deleted"),
    onError,
  });

  const close = () => {
    setOpen(false);
    setEditingJob(null);
    form.resetFields();
  };
  const submit = (values: JobFormValues) => {
    if (editingJob?.id) {
      updateMutation.mutate({ id: editingJob.id, values });
    } else {
      createMutation.mutate(values);
    }
  };

  return (
    <Card
      title={
        <Title level={5} style={{ margin: 0 }}>
          {t("contact.detail.job_info")}
        </Title>
      }
      extra={
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingJob(null);
            form.resetFields();
            setOpen(true);
          }}
        >
          {t("contact.detail.add_job")}
        </Button>
      }
    >
      {jobs.length > 0 ? (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {jobs.map((job) => {
            const companyName =
              job.company_name || `Company #${job.company_id}`;
            return (
              <li
                key={job.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                }}
              >
                <span>
                  <Text strong>{companyName}</Text>
                  <Text type="secondary" style={{ display: "block" }}>
                    {job.job_position || "—"}
                  </Text>
                </span>
                <Space size={0}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    aria-label={`${t("common.edit")}: ${companyName}`}
                    onClick={() => {
                      setEditingJob(job);
                      form.setFieldsValue({
                        company_name: companyName,
                        job_position: job.job_position,
                      });
                      setOpen(true);
                    }}
                  />
                  <Popconfirm
                    title={t("common.delete_confirm")}
                    onConfirm={() => job.id && deleteMutation.mutate(job.id)}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`${t("common.delete")}: ${companyName}`}
                    />
                  </Popconfirm>
                </Space>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          description={t("contact.detail.no_jobs")}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Link to={`/vaults/${vaultId}/settings`} style={{ fontSize: 12 }}>
            {t("contact.detail.manage_companies_hint")}
          </Link>
        </Empty>
      )}

      <Modal
        title={
          editingJob
            ? t("contact.detail.edit_job")
            : t("contact.detail.add_job")
        }
        open={open}
        onCancel={close}
        footer={null}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item
            name="company_name"
            label={t("contact.detail.company")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("common.required"),
              },
            ]}
          >
            <AutoComplete
              allowClear
              filterOption={(inputValue, option) =>
                String(option?.label ?? "")
                  .toLocaleLowerCase()
                  .includes(inputValue.toLocaleLowerCase())
              }
              options={companies.map((company) => ({
                label: company.name,
                value: company.name,
              }))}
              placeholder={t("contact.detail.company_placeholder")}
            />
          </Form.Item>
          <div style={{ marginTop: -12, marginBottom: 16, fontSize: 12 }}>
            <Text type="secondary">
              {t("contact.detail.company_create_hint")}
            </Text>
          </div>
          <Form.Item
            name="job_position"
            label={t("contact.detail.job_position")}
          >
            <Input />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={close}>{t("common.cancel")}</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {t("common.save")}
            </Button>
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
