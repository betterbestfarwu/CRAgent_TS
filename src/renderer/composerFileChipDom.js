const GENERIC_FILE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">' +
  '<path d="M4 2.5h5.2L12.5 5.8V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2"></path>' +
  "</svg>";

const CLOSE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">' +
  '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path>' +
  "</svg>";

/**
 * @param {{ id: string, name: string, path?: string }} file
 * @param {string} [iconUrl]
 */
export function createFileChipElement(file, iconUrl) {
  const span = document.createElement("span");
  span.className = "composer-at-chip composer-file-chip";
  span.contentEditable = "false";
  span.dataset.fileId = file.id;
  span.title = file.path || file.name;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "composer-at-chip-icon-btn";
  button.title = "移除";
  button.setAttribute("aria-label", `移除 ${file.name}`);

  const iconFile = document.createElement("span");
  iconFile.className = "composer-at-chip-icon composer-at-chip-icon-file";
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.className = "composer-file-sys-icon";
    img.width = 14;
    img.height = 14;
    iconFile.appendChild(img);
  } else {
    iconFile.innerHTML = GENERIC_FILE_ICON_SVG;
  }

  const iconClose = document.createElement("span");
  iconClose.className = "composer-at-chip-icon composer-at-chip-icon-close";
  iconClose.setAttribute("aria-hidden", "true");
  iconClose.innerHTML = CLOSE_ICON_SVG;

  button.append(iconFile, iconClose);

  const label = document.createElement("span");
  label.className = "composer-at-chip-label";
  label.textContent = file.name;

  span.append(button, label);
  return span;
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, string>} fileIcons
 */
export function updateFileChipIconsInDom(root, files, fileIcons) {
  if (!root) return;
  for (const file of files) {
    const path = file.path?.trim();
    const iconUrl = path ? fileIcons[path] : "";
    if (!iconUrl) continue;
    const chip = root.querySelector(`[data-file-id="${file.id}"]`);
    const iconHost = chip?.querySelector(".composer-at-chip-icon-file");
    if (!iconHost) continue;
    let img = iconHost.querySelector("img.composer-file-sys-icon");
    if (!img) {
      iconHost.replaceChildren();
      img = document.createElement("img");
      img.alt = "";
      img.className = "composer-file-sys-icon";
      img.width = 14;
      img.height = 14;
      iconHost.appendChild(img);
    }
    if (img.src !== iconUrl) {
      img.src = iconUrl;
    }
  }
}
