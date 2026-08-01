import { App as AntApp, ConfigProvider } from "antd";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VirtuosoMockContext } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";
import type { VaultTask } from "@/api";
import { VaultTaskList } from "@/pages/vault/VaultTaskList";
import type { DateFormatVariants } from "@/utils/dateFormat";

const dateFormats: DateFormatVariants = {
  full: "YYYY-MM-DD",
  short: "MMM D",
  dateTime: "YYYY-MM-DD HH:mm",
  dateTimeFull: "YYYY-MM-DD HH:mm:ss",
  monthYear: "YYYY-MM",
};

function createTask(overrides: Partial<VaultTask>): VaultTask {
  return {
    id: 0,
    label: "",
    completed: false,
    contacts: [],
    ...overrides,
  };
}

function renderTaskList(
  pendingTasks: readonly VaultTask[],
  completedTasks: readonly VaultTask[],
) {
  const onSelectTask = vi.fn();
  const onNavigateToContact = vi.fn();

  render(
    <ConfigProvider>
      <AntApp>
        <VirtuosoMockContext.Provider
          value={{ viewportHeight: 800, itemHeight: 72 }}
        >
          <VaultTaskList
            pendingTasks={pendingTasks}
            completedTasks={completedTasks}
            dateFormats={dateFormats}
            onSelectTask={onSelectTask}
            onNavigateToContact={onNavigateToContact}
          />
        </VirtuosoMockContext.Provider>
      </AntApp>
    </ConfigProvider>,
  );

  return { onSelectTask, onNavigateToContact };
}

function renderTaskListWithoutMeasuredViewport(
  pendingTasks: readonly VaultTask[],
) {
  render(
    <ConfigProvider>
      <AntApp>
        <VaultTaskList
          pendingTasks={pendingTasks}
          completedTasks={[]}
          dateFormats={dateFormats}
          onSelectTask={vi.fn()}
          onNavigateToContact={vi.fn()}
        />
      </AntApp>
    </ConfigProvider>,
  );
}

describe("VaultTaskList", () => {
  it("renders a probe row before the window viewport has a measured height", () => {
    const pendingTask = createTask({ id: 1, label: "Initial probe task" });

    renderTaskListWithoutMeasuredViewport([pendingTask]);

    expect(screen.getByText("Initial probe task")).toBeVisible();
  });

  it("renders pending tasks through one measured virtual list", () => {
    const pendingTask = createTask({ id: 1, label: "Pending task" });

    renderTaskList([pendingTask], []);

    expect(screen.getByText("Pending task")).toBeVisible();
    expect(
      document.querySelectorAll('[data-viewport-type="window"]'),
    ).toHaveLength(1);
  });

  it("renders the completed divider and completed tasks through the same measured list", () => {
    const completedTask = createTask({
      id: 2,
      label: "Completed task",
      completed: true,
    });

    renderTaskList([], [completedTask]);

    expect(screen.getByText("Completed (1)")).toBeVisible();
    expect(screen.getByText("Completed task")).toBeVisible();
    expect(
      document.querySelectorAll('[data-viewport-type="window"]'),
    ).toHaveLength(1);
  });

  it("uses one measurement system when pending content exceeds the viewport estimate", () => {
    const pendingTasks = Array.from({ length: 20 }, (_, index) =>
      createTask({ id: index + 1, label: `Pending task ${index + 1}` }),
    );
    const completedTask = createTask({
      id: 100,
      label: "Completed task",
      completed: true,
    });

    renderTaskList(pendingTasks, [completedTask]);

    expect(screen.getByText("Pending task 1")).toBeVisible();
    expect(
      document.querySelectorAll('[data-viewport-type="window"]'),
    ).toHaveLength(1);
  });

  it("preserves row selection and contact navigation", async () => {
    const user = userEvent.setup();
    const task = createTask({
      id: 3,
      label: "Contact task",
      contacts: [{ id: "contact-1", name: "Visible Contact" }],
    });
    const { onSelectTask, onNavigateToContact } = renderTaskList([task], []);
    const taskRow = screen.getByText("Contact task").closest(".ant-list-item");
    if (taskRow === null) {
      throw new Error("Task row was not rendered");
    }

    await user.click(taskRow);
    await user.click(screen.getByRole("button", { name: /visible contact/i }));

    expect(onSelectTask).toHaveBeenCalledWith(task);
    expect(onNavigateToContact).toHaveBeenCalledWith("contact-1");
    expect(onSelectTask).toHaveBeenCalledTimes(1);
  });
});
