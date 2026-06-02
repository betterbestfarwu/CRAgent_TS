import { useEffect, useState } from "react";

export function PlanApprovalDialog({
  displayPath,
  content,
  onClose,
}) {
  const [draft, setDraft] = useState(content || "");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setDraft(content || "");
    setFeedback("");
  }, [content]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose({ approved: false, content: draft, feedback });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, draft, feedback]);

  function reject() {
    onClose({ approved: false, content: draft, feedback });
  }

  return (
    <div className="confirm-overlay" role="presentation" onClick={reject}>
      <div
        className="confirm-dialog plan-approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-approval-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div id="plan-approval-title" className="confirm-dialog-title">
          审阅计划
        </div>
        <p className="plan-approval-path" title={displayPath}>
          {displayPath}
        </p>
        <label className="plan-approval-label" htmlFor="plan-approval-editor">
          计划内容
        </label>
        <textarea
          id="plan-approval-editor"
          className="plan-approval-editor"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          aria-label="计划内容"
        />
        <label className="plan-approval-label" htmlFor="plan-approval-feedback">
          修改意见（可选）
        </label>
        <textarea
          id="plan-approval-feedback"
          className="plan-approval-feedback"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="说明需要调整的方向，模型会据此修订计划…"
          spellCheck={false}
          aria-label="计划修改意见"
        />
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-btn" onClick={reject}>
            继续规划
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-primary"
            onClick={() => onClose({ approved: true, content: draft, feedback })}
          >
            批准并开始执行
          </button>
        </div>
      </div>
    </div>
  );
}
