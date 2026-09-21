#!/usr/bin/env bash
# Install the skill for Claude Code and Codex by symlinking this directory.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="$(basename "$SRC")"

# ~/.agents/skills is the shared location Codex reads; Claude Code reads ~/.claude/skills.
# ~/.codex/skills is kept for older Codex builds.
for dir in "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  mkdir -p "$dir"
  ln -sfn "$SRC" "$dir/$NAME"
  echo "linked $dir/$NAME"
done

cat <<TXT

Installed. Open a Flutter project, start a NEW session (skills are loaded at startup), then:

  Claude Code   /$NAME app_name=my_app appmetrica_key=<key>
  Codex         \$$NAME instrument this app

Dry run first (writes only the plan):

  Claude Code   /$NAME dry_run=true
TXT
