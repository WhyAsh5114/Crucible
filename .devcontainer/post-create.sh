#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.com/install | bash
fi

line1='export BUN_INSTALL="$HOME/.bun"'
line2='export PATH="$BUN_INSTALL/bin:$PATH"'

for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  touch "$rc"
  grep -qxF "$line1" "$rc" || printf "\n%s\n" "$line1" >>"$rc"
  grep -qxF "$line2" "$rc" || printf "%s\n" "$line2" >>"$rc"
done

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

bun --version
bun --revision
bun install

if command -v sudo >/dev/null 2>&1; then
  sudo mkdir -p /var/lib/crucible/workspaces
  sudo chown -R vscode:vscode /var/lib/crucible
else
  mkdir -p /var/lib/crucible/workspaces
fi

git config core.hooksPath .githooks
