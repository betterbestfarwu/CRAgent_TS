import test from "node:test";
import assert from "node:assert/strict";
import {
    detectClarificationNeeded,
    formatClarificationAnswers,
} from "@shared/userClarification.js";

test("detectClarificationNeeded matches learning check-in mini program requests", () => {
    const hit = detectClarificationNeeded("帮我创建一个学习打卡的小程序");
    assert.ok(hit);
    assert.equal(hit.questions.length, 1);
    assert.match(hit.questions[0].prompt, /学习打卡/);
});

test("detectClarificationNeeded ignores generic greetings", () => {
    assert.equal(detectClarificationNeeded("你好"), null);
});

test("formatClarificationAnswers summarizes user choice", () => {
    const questions = detectClarificationNeeded("帮我创建学习打卡小程序").questions;
    const text = formatClarificationAnswers(questions, { 0: "wechat" });
    assert.match(text, /微信小程序/);
});
