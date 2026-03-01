#!/bin/bash
# Agent Office — Claude Code Plugin Installer
# Usage: ./install.sh [target-project-path]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$(pwd)}"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${BLUE}⬡ Agent Office Installer${NC}"
echo "  Target project: $TARGET"
echo ""

# 1. Copy hooks into target project
mkdir -p "$TARGET/.claude/hooks"
cp "$SCRIPT_DIR/.claude/hooks/send_event.py" "$TARGET/.claude/hooks/send_event.py"
chmod +x "$TARGET/.claude/hooks/send_event.py"
echo -e "${GREEN}✓${NC} Hook script installed → .claude/hooks/send_event.py"

# 2. Merge or create settings.json
SETTINGS="$TARGET/.claude/settings.json"
HOOKS_JSON="$SCRIPT_DIR/.claude/settings.json"

if [ -f "$SETTINGS" ]; then
  echo -e "${YELLOW}!${NC} Existing .claude/settings.json found — merging hooks..."
  # Simple approach: back up and replace (user can merge manually if needed)
  cp "$SETTINGS" "$SETTINGS.bak"
  cp "$HOOKS_JSON" "$SETTINGS"
  echo -e "${GREEN}✓${NC} settings.json updated (backup saved as settings.json.bak)"
else
  cp "$HOOKS_JSON" "$SETTINGS"
  echo -e "${GREEN}✓${NC} settings.json created → .claude/settings.json"
fi

# 3. Install server dependencies
echo ""
echo "Installing server dependencies..."
cd "$SCRIPT_DIR/server"
if command -v npm &> /dev/null; then
  npm install --silent
  echo -e "${GREEN}✓${NC} Server dependencies installed"
else
  echo -e "${YELLOW}!${NC} npm not found — install Node.js then run: cd server && npm install"
fi

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo "  To start the visualization server:"
echo -e "  ${BLUE}cd $SCRIPT_DIR/server && node index.js${NC}"
echo ""
echo "  Then open: http://localhost:4242"
echo "  Then run Claude Code in your project — agents appear automatically."
echo ""
