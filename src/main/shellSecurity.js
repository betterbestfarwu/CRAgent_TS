import { scanBashSecurity } from "./bashSecurityChecks.js";
import { scanPowerShellSecurity } from "./powershellSecurityChecks.js";
import { SHELL_KIND } from "./shellRuntime.js";

/**
 * Run shell security checks appropriate for the resolved shell kind.
 * @param {string} command
 * @param {import('./shellRuntime.js').ShellKind | import('./shellRuntime.js').ShellRuntime} shellKindOrRuntime
 * @param {{ platform?: string }} [options]
 */
export function scanShellSecurity(command, shellKindOrRuntime, options = {}) {
    const kind =
        typeof shellKindOrRuntime === "string" ? shellKindOrRuntime : shellKindOrRuntime?.kind;
    const platform = options.platform ?? process.platform;
    if (kind === SHELL_KIND.POWERSHELL) {
        return scanPowerShellSecurity(command);
    }
    return scanBashSecurity(command, { shellKind: kind, platform });
}

export { BASH_SECURITY_CHECK_IDS, listBashSecurityCheckIds } from "./bashSecurityChecks.js";
