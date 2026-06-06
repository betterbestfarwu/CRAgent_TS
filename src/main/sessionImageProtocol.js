import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { SESSION_IMAGE_SCHEME, parseSessionImageUrl } from "@shared/sessionImageUrl.js";
import { getSessionImageFilePath } from "./sessionImageStorage.js";

export function registerSessionImageScheme() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: SESSION_IMAGE_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
    ]);
}

export function registerSessionImageProtocol(resolveSessionsDir) {
    protocol.handle(SESSION_IMAGE_SCHEME, async (request) => {
        const parsed = parseSessionImageUrl(request.url);
        if (!parsed) {
            return new Response("Not found", { status: 404 });
        }

        let sessionsDir;
        try {
            sessionsDir = resolveSessionsDir(parsed.sessionId);
        } catch {
            return new Response("Not found", { status: 404 });
        }

        const filePath = getSessionImageFilePath(
            sessionsDir,
            parsed.sessionId,
            parsed.imageFile,
        );
        if (!filePath) {
            return new Response("Not found", { status: 404 });
        }

        return net.fetch(pathToFileURL(filePath).href);
    });
}
