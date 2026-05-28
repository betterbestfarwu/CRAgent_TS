import { useMemo } from "react";

const SLASH_COMMANDS = [
  {
    name: "new",
    description: "新建会话（与菜单 New Chat 相同）",
  },
  {
    name: "help",
    description: "显示可用 slash 指令与工作区说明",
  },
  {
    name: "clear",
    description: "插入上下文分界，保留聊天记录",
  },
  {
    name: "compact",
    description: "将较早上下文压缩为摘要（保留最近几轮完整消息）",
  },
];

const SKILLS_COLLAPSED_COUNT = 3;

function matchesQuery(name, description, query) {
  if (!query) return true;
  const n = String(name || "").toLowerCase();
  const d = String(description || "").toLowerCase();
  return n.includes(query) || d.includes(query);
}

function truncateDescription(text, maxLen = 72) {
  const s = String(text || "").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

export function buildSlashMenuNavItems(filteredSkills, filteredCommands, skillsExpanded) {
  const items = [];
  const visibleSkills = skillsExpanded
    ? filteredSkills
    : filteredSkills.slice(0, SKILLS_COLLAPSED_COUNT);
  for (const skill of visibleSkills) {
    items.push({ kind: "pick", name: skill.name });
  }
  const hiddenCount = filteredSkills.length - visibleSkills.length;
  if (hiddenCount > 0 && !skillsExpanded) {
    items.push({ kind: "expand", count: hiddenCount });
  }
  for (const command of filteredCommands) {
    items.push({ kind: "pick", name: command.name });
  }
  return items;
}

export function filterSlashSkills(skills, query) {
  return skills.filter((skill) =>
    matchesQuery(skill?.name, skill?.description, query),
  );
}

export function filterSlashCommands(query) {
  return SLASH_COMMANDS.filter((command) =>
    matchesQuery(command.name, command.description, query),
  );
}

export function ComposerSlashMenu({
  skills,
  query,
  selectedIndex,
  skillsExpanded,
  onSkillsExpandedChange,
  onPick,
  onHoverIndex,
}) {
  const filteredSkills = useMemo(() => filterSlashSkills(skills, query), [skills, query]);
  const filteredCommands = useMemo(() => filterSlashCommands(query), [query]);

  const visibleSkills = skillsExpanded
    ? filteredSkills
    : filteredSkills.slice(0, SKILLS_COLLAPSED_COUNT);
  const hiddenSkillCount = filteredSkills.length - visibleSkills.length;

  let rowIndex = -1;

  if (!filteredSkills.length && !filteredCommands.length) {
    return (
      <div className="slash-menu" role="listbox" aria-label="Slash menu">
        <div className="slash-menu-empty">无匹配项</div>
      </div>
    );
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="Slash menu">
      {filteredSkills.length > 0 ? (
        <div className="slash-menu-section">
          <div className="slash-menu-section-label">Skills</div>
          {visibleSkills.map((skill, localIndex) => {
            rowIndex += 1;
            const index = rowIndex;
            const active = index === selectedIndex;
            return (
              <button
                key={skill.name}
                type="button"
                role="option"
                aria-selected={active}
                className={`slash-menu-item${active ? " active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHoverIndex(index)}
                onClick={() => onPick(skill.name)}
              >
                <div className="slash-menu-item-title">/{skill.name}</div>
                {skill.description ? (
                  <div className="slash-menu-item-desc">
                    {truncateDescription(skill.description)}
                  </div>
                ) : null}
              </button>
            );
          })}
          {hiddenSkillCount > 0 && !skillsExpanded ? (
            (() => {
              rowIndex += 1;
              const index = rowIndex;
              const active = index === selectedIndex;
              return (
                <button
                  key="show-more"
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`slash-menu-more${active ? " active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => onHoverIndex(index)}
                  onClick={() => onSkillsExpandedChange(true)}
                >
                  Show {hiddenSkillCount} more
                </button>
              );
            })()
          ) : null}
        </div>
      ) : null}

      {filteredCommands.length > 0 ? (
        <div className="slash-menu-section">
          <div className="slash-menu-section-label">Commands</div>
          {filteredCommands.map((command) => {
            rowIndex += 1;
            const index = rowIndex;
            const active = index === selectedIndex;
            return (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={active}
                className={`slash-menu-item${active ? " active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHoverIndex(index)}
                onClick={() => onPick(command.name)}
              >
                <div className="slash-menu-item-title">/{command.name}</div>
                <div className="slash-menu-item-desc">
                  {truncateDescription(command.description)}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
