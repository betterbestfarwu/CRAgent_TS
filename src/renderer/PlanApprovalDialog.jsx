import { useEffect, useMemo, useState } from "react";

function renderPlanMarkdown(content) {
  if (typeof window !== "undefined" && window.MD?.render) {
    return window.MD.render(content || "");
  }
  return "";
}

export function PlanApprovalDialog({
  displayPath,
  content,
  onClose,
}) {
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setFeedback("");
  }, [content]);

  const renderedContent = useMemo(
    () => renderPlanMarkdown(content),
    [content],
  );

  function dismiss(event) {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    onClose({ dismissed: true });
  }

  function reject(event) {
    event?.stopPropagation?.();
    onClose({ rejected: true, content, feedback });
  }

  function approve(event) {
    event?.stopPropagation?.();
    onClose({ approved: true, content, feedback });
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose({ dismissed: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="confirm-overlay" role="presentation">
      <div
        className="confirm-dialog plan-approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-approval-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="plan-approval-close"
          title="关闭"
          aria-label="关闭"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={dismiss}
        >
          ×
        </button>
        <div className="confirm-dialog-header plan-approval-header">
          <h2 id="plan-approval-title" className="confirm-dialog-title plan-approval-title">
            审阅计划
          </h2>
        </div>
        <p className="plan-approval-path" title={displayPath}>
          {displayPath}
        </p>
        <div className="plan-approval-label">计划内容</div>
        <div className="plan-approval-content-wrap">
          <div
            className="plan-approval-content"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </div>
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
            onClick={approve}
          >
            批准并开始执行
          </button>
        </div>
      </div>
    </div>
  );
}
