export const AUTH_MODES = {
  default: {
    id: "default",
    label: "默认权限",
    description:
      "标准安全模式：可在工作区内读写文件；执行命令、访问外部文件或网络时会请求确认。",
  },
  autoReview: {
    id: "autoReview",
    label: "自动审查",
    description:
      "偏向全自动：沙箱内自动执行，高风险行为后台审查，仅在必要时才请求确认。",
  },
  fullAccess: {
    id: "fullAccess",
    label: "完全访问权限",
    description:
      "最高权限（danger-full-access）：可读写任意文件、执行任意命令、访问网络，无需审批。",
  },
};

export const AUTH_MODE_IDS = Object.keys(AUTH_MODES);

export function normalizeAuthMode(value) {
  return AUTH_MODE_IDS.includes(value) ? value : "default";
}
