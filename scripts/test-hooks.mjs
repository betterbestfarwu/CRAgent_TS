#!/usr/bin/env node
/**
 * Manual hooks tester — loads hooks.json from session workspace or config dir.
 *
 * Usage:
 *   node --import ./test/register-test.mjs scripts/test-hooks.mjs
 *   npm run test:hooks:live
 *   npm run test:hooks
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HookRunner } from "../src/main/hooks/hookRunner.js";
import { hooksFilePath, resolveHooksConfig } from "../src/main/hooks/hookPaths.js";
import { ConfigStore } from "../src/main/configStore.js";
import { SessionStore } from "../src/main/sessionStore.js";
import { HOOKS_CONFIG_FILENAME, hookMatchQueryForEvent, normalizeHookEvent, parseHooksFileJson } from "../src/shared/hooksConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SAMPLE_EXTRA = {
    UserPromptSubmit: { prompt: "hello from test-hooks (SECRET probe)" },
    PreToolUse: {
        tool_name: "bash",
        tool_input: { command: "echo hi" },
        tool_use_id: "test-tool-use-1",
    },
    PostToolUse: {
        tool_name: "read_file",
        tool_input: { path: "README.md" },
        tool_response: "file contents",
        tool_use_id: "test-tool-use-1",
    },
    PostToolUseFailure: {
        tool_name: "read_file",
        tool_input: { path: "missing.txt" },
        tool_use_id: "test-tool-use-1",
        error: "Error: file not found",
    },
    BeforeShellExecution: { command: "echo hi" },
    AfterShellExecution: { command: "echo hi", output: "hi\n" },
    SessionStart: { source: "startup" },
    SessionEnd: { reason: "other" },
    Stop: { stop_hook_active: false, last_assistant_message: "done" },
    SubagentStart: { agent_id: "sub-1", agent_type: "generalPurpose" },
    SubagentStop: {
        stop_hook_active: false,
        agent_id: "sub-1",
        agent_type: "generalPurpose",
        last_assistant_message: "sub done",
    },
    PreCompact: { trigger: "manual" },
    PostCompact: { trigger: "manual" },
};

function parseArgs(argv) {
    const opts = {
        project: process.cwd(),
        event: null,
        installExample: false,
        runUnitTests: false,
        sessionId: "test-hooks-session",
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--project" || arg === "-p") {
            opts.project = path.resolve(argv[++i] || "");
        } else if (arg === "--event" || arg === "-e") {
            opts.event = normalizeHookEvent(argv[++i] || "");
        } else if (arg === "--install-example") {
            opts.installExample = true;
        } else if (arg === "--unit") {
            opts.runUnitTests = true;
        } else if (arg === "--help" || arg === "-h") {
            opts.help = true;
        }
    }
    return opts;
}

function printHelp() {
    console.log(`CRAgent hooks tester

Options:
  --project, -p <dir>   Session workspace root (default: cwd)
  --event, -e <name>    Run one event only
  --install-example     Copy hooks.json.example + hooks/*.sh into project
  --unit                Run node:test hook suites
  -h, --help

Resolution order (same as app):
  1. {workspace}/hooks.json
  2. {config.json dir}/hooks.json

Examples:
  npm run test:hooks:live
  npm run test:hooks:live -- --install-example -p .
`);
}

function installExample(projectRoot) {
    const src = path.join(REPO_ROOT, "hooks.json.example");
    const dest = path.join(projectRoot, HOOKS_CONFIG_FILENAME);
    const hooksScripts = path.join(REPO_ROOT, "hooks");

    if (!fs.existsSync(src)) {
        console.error(`Missing example: ${src}`);
        process.exit(1);
    }
    fs.mkdirSync(path.join(projectRoot, "hooks"), { recursive: true });
    fs.copyFileSync(src, dest);

    for (const name of fs.readdirSync(hooksScripts)) {
        if (!name.endsWith(".sh")) continue;
        const from = path.join(hooksScripts, name);
        const to = path.join(projectRoot, "hooks", name);
        fs.copyFileSync(from, to);
        fs.chmodSync(to, 0o755);
    }
    console.log(`Installed:\n  ${dest}\n  ${path.join(projectRoot, "hooks")}/*.sh`);
}

function createTestContext(projectRoot) {
    const configFile = path.join(projectRoot, ".test-config.json");
    if (!fs.existsSync(configFile)) {
        fs.writeFileSync(configFile, JSON.stringify({ agents: { default: { model: { primary: "x/y" } } }, models: {} }, null, 2));
    }
    const configStore = new ConfigStore(configFile);
    const sessionsDir = path.join(projectRoot, ".test-sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionStore = new SessionStore(sessionsDir, configStore.resolvePrimaryRef());
    const project = sessionStore.addProject(projectRoot);
    const session = sessionStore.newSession({ projectId: project.id });
    return { configStore, sessionStore, sessionId: session.meta.id };
}

async function runHookChecks(projectRoot, filterEvent, sessionId, configStore, sessionStore) {
    const resolved = resolveHooksConfig({
        sessionStore,
        configStore,
        sessionId,
    });

    console.log(`  [hooks] workspace: ${hooksFilePath(projectRoot)}`);
    console.log(`  [hooks] using: ${resolved.hooksFile} (${resolved.source})`);

    if (!fs.existsSync(resolved.hooksFile)) {
        console.error("\nNo hooks.json found. Try: npm run test:hooks:live -- --install-example -p .");
        process.exit(1);
    }

    const raw = JSON.parse(fs.readFileSync(resolved.hooksFile, "utf-8"));
    const manifest = parseHooksFileJson(raw).hooks;
    const events = Object.keys(manifest).filter((event) => (filterEvent ? event === filterEvent : true));

    const runner = new HookRunner({
        getHooksConfig: () => resolved,
        getSessionMeta: () => ({
            transcriptPath: path.join(projectRoot, "test-session.json"),
            cwd: projectRoot,
            permissionMode: "default",
        }),
    });

    let passed = 0;
    let failed = 0;
    console.log("\nRunning hooks:\n");

    for (const event of events.sort()) {
        const defs = manifest[event];
        const extra = SAMPLE_EXTRA[event] || {};
        const hookInput = runner.buildBaseInput(sessionId, event, extra);
        const matchQuery =
            event === "UserPromptSubmit"
                ? hookInput.prompt
                : hookMatchQueryForEvent(event, hookInput);

        console.log(`▸ ${event} (${defs.length} definition(s))`);
        for (const def of defs) {
            console.log(`    ${def.command}${def.matcher ? `  matcher=${def.matcher}` : ""}`);
        }

        try {
            const result = await runner.run(event, hookInput, { matchQuery });
            if (result.blocked) {
                console.log(`    → blocked: ${result.reason || "(no reason)"}`);
            } else if (result.updatedInput) {
                console.log(`    → updatedInput: ${JSON.stringify(result.updatedInput)}`);
            } else {
                console.log("    → ok");
            }
            passed += 1;
        } catch (error) {
            console.error(`    → ERROR: ${error.message}`);
            failed += 1;
        }
        console.log("");
    }

    console.log(`Done: ${passed} event(s) ok, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

async function runUnitTests() {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "--import",
                "./test/register-test.mjs",
                "--test",
                "test/hooksConfig.test.js",
                "test/hookRunner.test.js",
                "test/hooksAgentIntegration.test.js",
                "test/hookPaths.test.js",
            ],
            { cwd: REPO_ROOT, stdio: "inherit" },
        );
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    });
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        printHelp();
        return;
    }

    console.log("CRAgent hooks tester\n");
    console.log(`Workspace: ${opts.project}`);

    if (opts.installExample) {
        installExample(opts.project);
    }

    if (opts.runUnitTests) {
        console.log("\nUnit tests:\n");
        await runUnitTests();
    }

    const wantsLive =
        !opts.runUnitTests ||
        opts.installExample ||
        opts.event ||
        process.argv.includes("--project") ||
        process.argv.includes("-p");
    if (!wantsLive) {
        return;
    }

    if (opts.event && !normalizeHookEvent(opts.event)) {
        console.error(`Unknown event: ${opts.event}`);
        process.exit(1);
    }

    const { configStore, sessionStore, sessionId } = createTestContext(opts.project);
    console.log("\nConfig:");
    await runHookChecks(opts.project, opts.event, sessionId, configStore, sessionStore);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
