import { getCurrentInProgressTodo, todoDisplayLabel } from "@shared/chatUiUtils.js";

export function ComposerTaskStatus({ todos, busy }) {
  if (!busy) {
    return null;
  }
  const current = getCurrentInProgressTodo(todos);
  if (!current) {
    return null;
  }
  const label = todoDisplayLabel(current);
  if (!label) {
    return null;
  }

  return (
    <div className="composer-task-status" role="status" aria-live="polite">
      <span className="composer-task-status-mark" aria-hidden="true">
        →
      </span>
      <span className="composer-task-status-text">{label}</span>
    </div>
  );
}
