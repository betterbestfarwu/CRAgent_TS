#!/bin/bash
# Blocks prompts containing SECRET or password= (see hooks.json.example matcher).
input=$(cat)
if echo "$input" | grep -qiE 'SECRET|password[[:space:]]*='; then
  echo '{"decision":"block","reason":"Example hook blocked a sensitive-looking prompt."}' >&2
  exit 2
fi
echo '{}'
exit 0
