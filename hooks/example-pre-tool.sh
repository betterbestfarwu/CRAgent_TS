#!/bin/bash
# Example: log bash commands to stderr (visible in devtools) without blocking.
input=$(cat)
echo "[example-pre-tool] $(echo "$input" | head -c 200)" >&2
echo '{}'
exit 0
