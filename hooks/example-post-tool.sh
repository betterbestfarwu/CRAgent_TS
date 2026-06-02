#!/bin/bash
# Example: append audit note after each tool (Claude Code hookSpecificOutput shape).
input=$(cat)
tool=$(echo "$input" | grep -o '"tool_name":"[^"]*"' | head -1)
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"[example hook] completed ${tool}\"}}"
exit 0
