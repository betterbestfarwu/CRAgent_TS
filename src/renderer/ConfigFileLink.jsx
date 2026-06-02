export function openConfigFile() {
    void window.cragent?.openConfigFile?.();
}

export function ConfigFileLink({ label = "config.json" }) {
    return (
        <button
            type="button"
            className="settings-file-link"
            title="打开 config.json"
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openConfigFile();
            }}
        >
            {label}
        </button>
    );
}

export function withConfigFileLinks(text) {
    const parts = String(text).split(/(config\.json)/g);
    if (parts.length === 1) {
        return text;
    }
    return parts.map((part, index) =>
        part === "config.json" ? <ConfigFileLink key={`config-file-${index}`} /> : part,
    );
}
