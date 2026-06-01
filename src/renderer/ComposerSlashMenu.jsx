import { useMemo } from "react";
import { filterSlashCommands as filterChatCommands } from "@shared/chatCommands";

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

function SlashMenuItemIcon({ section }) {
  if (section === "commands") {
    return (
      <span className="slash-menu-item-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path
            d="M9.25 1.5 4.75 8h3l-1 6.5L11.25 8h-3l1-6.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="slash-menu-item-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
        <path
          d="m8 1.75 1.5 3.2 3.25 1.55-3.25 1.55L8 11.25l-1.5-3.2L3.25 6.5 6.5 4.95 8 1.75Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
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
  return filterChatCommands(query);
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
                <SlashMenuItemIcon section="skills" />
                <div className="slash-menu-item-content">
                  <div className="slash-menu-item-title">{skill.name}</div>
                  {skill.description ? (
                    <div className="slash-menu-item-desc">
                      {truncateDescription(skill.description)}
                    </div>
                  ) : null}
                </div>
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
                <SlashMenuItemIcon section="commands" />
                <div className="slash-menu-item-content">
                  <div className="slash-menu-item-title">{command.name}</div>
                  <div className="slash-menu-item-desc">
                    {truncateDescription(command.description)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
