const STATUS_LABELS = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};

export function TodoPanel({ todos }) {
  const active = (todos || []).filter((item) => item.status !== "cancelled");
  if (!active.length) {
    return null;
  }

  return (
    <section className="todo-panel" aria-label="任务列表">
      <div className="todo-panel-header">Tasks</div>
      <ul className="todo-list">
        {active.map((item) => (
          <li
            key={item.id}
            className={`todo-item todo-item-${item.status}`}
            data-status={item.status}
          >
            <span className="todo-status" aria-hidden="true">
              {item.status === "completed" ? "✓" : item.status === "in_progress" ? "→" : "○"}
            </span>
            <span className="todo-content">{item.content}</span>
            <span className="todo-status-label">{STATUS_LABELS[item.status] || item.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
