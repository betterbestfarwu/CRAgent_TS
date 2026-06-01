import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
    entryPoints: [path.join(root, "src/shared/chatUiUtils.js")],
    outfile: path.join(root, "public/chat/chatUiUtils.js"),
    format: "iife",
    globalName: "CRAgentChatUtils",
    bundle: true,
    platform: "browser",
    target: "es2020",
});

console.log("Built public/chat/chatUiUtils.js");
