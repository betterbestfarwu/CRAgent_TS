/**
 * Heuristic prompts shown before the agent loop when the user request is ambiguous.
 * Complements the optional `ask_user` tool (models often skip tool calls).
 */

const CHECKIN_APP_QUESTIONS = [
    {
        id: "platform",
        prompt: "你想做哪一种「学习打卡」形式？",
        options: [
            { id: "wechat", label: "微信小程序" },
            { id: "web", label: "独立 Web / H5 页面" },
            { id: "in_repo", label: "集成进当前项目（如 CRAgent 内新页面）" },
        ],
    },
];

/**
 * @param {string} text
 * @returns {{ questions: typeof CHECKIN_APP_QUESTIONS } | null}
 */
export function detectClarificationNeeded(text) {
    const normalized = String(text || "").trim();
    if (!normalized) {
        return null;
    }
    const wantsBuild =
        /创建|做一个|帮我做|帮我创建|开发|搭建|建一个|做一个|设计/.test(normalized);
    const appScope = /小程序|打卡|应用|app|系统|页面/.test(normalized);
    const learningOrHabit = /学习|打卡|习惯|健身|读书|课程/.test(normalized);
    if (wantsBuild && appScope && learningOrHabit) {
        return { questions: CHECKIN_APP_QUESTIONS };
    }
    if (wantsBuild && /学习打卡|打卡小程序|打卡.*小程序|小程序.*打卡/.test(normalized)) {
        return { questions: CHECKIN_APP_QUESTIONS };
    }
    return null;
}

/**
 * @param {Array<{ prompt?: string, question?: string, options?: Array<{ id: string, label?: string }> }>} questions
 * @param {Record<string, string>} answers
 */
export function formatClarificationAnswers(questions, answers) {
    const lines = [];
    for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index];
        const prompt = question.prompt || question.question || `问题 ${index + 1}`;
        const answerId = answers[String(index)] ?? answers[question.id] ?? "";
        const option = (question.options || []).find((entry) => entry.id === answerId);
        lines.push(`${prompt} → ${option?.label || answerId || "（未选择）"}`);
    }
    return lines.join("\n");
}
