import { App } from "antd";
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { APIError, CreateReminderRequest } from "@/api";
import type { CalendarDatePickerValue } from "@/components/CalendarDatePicker";
import { getCalendarSystem } from "@/utils/calendar";
import {
  invalidateCalendarQueries,
  invalidateFeedQueries,
  queryKeyPrefixes,
  type ContactQueryScope,
  type QueryInvalidationScopes,
} from "@/utils/queryInvalidation";
import type { ContactSaveMutationOperation } from "./contactSaveMutationOperation";

export type ReminderSaveFormValues = {
  readonly label: string;
  readonly calendarDate: CalendarDatePickerValue;
  readonly frequency: string;
};

type ReminderMutationContext = {
  readonly source: ContactQueryScope;
  readonly listQueryKey: QueryKey;
  readonly affectedScopes: QueryInvalidationScopes;
};

export type ReminderSaveMutationOperation =
  ContactSaveMutationOperation<ReminderSaveFormValues> &
    ReminderMutationContext;

export type ReminderDeleteMutationOperation = ReminderMutationContext & {
  readonly kind: "delete";
  readonly id: number;
};

type ReminderMutationConfig = {
  readonly closeSaveForm: () => void;
};

function buildReminderRequest(
  values: ReminderSaveFormValues,
): CreateReminderRequest {
  const { label, calendarDate, frequency } = values;
  if (calendarDate.day == null || calendarDate.month == null) {
    throw new Error("reminder date requires month and day");
  }

  const request: CreateReminderRequest = {
    label,
    type: frequency,
    calendar_type: calendarDate.calendarType,
  };
  if (calendarDate.datePrecision === "month_day") {
    request.day = calendarDate.day;
    request.month = calendarDate.month;
    return request;
  }
  if (calendarDate.year == null) {
    throw new Error("full reminder date requires year");
  }

  const gregorianDate = getCalendarSystem(
    calendarDate.calendarType,
  ).toGregorian({
    day: calendarDate.day,
    month: calendarDate.month,
    year: calendarDate.year,
  });
  request.day = gregorianDate.day;
  request.month = gregorianDate.month;
  request.year = gregorianDate.year;
  if (calendarDate.calendarType !== "gregorian") {
    request.original_day = calendarDate.day;
    request.original_month = calendarDate.month;
    request.original_year = calendarDate.year;
  }
  return request;
}

export function useReminderMutations({
  closeSaveForm,
}: ReminderMutationConfig) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();

  const saveMutation = useMutation({
    mutationFn: (operation: ReminderSaveMutationOperation) => {
      const request = buildReminderRequest(operation.values);
      switch (operation.kind) {
        case "create":
          return api.reminders.contactsRemindersCreate(
            operation.source.vaultId,
            operation.source.contactId,
            request,
          );
        case "update":
          return api.reminders.contactsRemindersUpdate(
            operation.source.vaultId,
            operation.source.contactId,
            operation.id,
            request,
          );
      }
    },
    onSuccess: async (_data, operation) => {
      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: queryKeyPrefixes.reminder.vault(operation.source.vaultId),
        }),
        queryClient.invalidateQueries({ queryKey: operation.listQueryKey }),
        invalidateCalendarQueries(queryClient, operation.affectedScopes),
      ];
      if (operation.kind === "create") {
        invalidations.push(
          invalidateFeedQueries(queryClient, operation.affectedScopes),
        );
      }
      await Promise.all(invalidations);
      closeSaveForm();
      message.success(
        operation.kind === "update"
          ? t("modules.reminders.updated")
          : t("modules.reminders.added"),
      );
    },
    onError: (error: APIError) => message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (operation: ReminderDeleteMutationOperation) =>
      api.reminders.contactsRemindersDelete(
        operation.source.vaultId,
        operation.source.contactId,
        operation.id,
      ),
    onSuccess: async (_data, operation) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeyPrefixes.reminder.vault(operation.source.vaultId),
        }),
        queryClient.invalidateQueries({ queryKey: operation.listQueryKey }),
        invalidateCalendarQueries(queryClient, operation.affectedScopes),
        invalidateFeedQueries(queryClient, operation.affectedScopes),
      ]);
      message.success(t("modules.reminders.deleted"));
    },
    onError: (error: APIError) => message.error(error.message),
  });

  return { saveMutation, deleteMutation };
}
