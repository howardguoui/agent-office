#!/bin/bash
# Agent Office Plugin Installer
# Usage: ./install.sh [project-path]

set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${1:-$(pwd)}"

echo -e "\n${BLUE}⬡ Installing Agent Office Plugin${NC}\n"

# 1. Install npm dependencies
echo "Installing dependencies..."
cd "$PLUGIN_DIR"
npm install --silent
echo -e "${GREEN}✓${NC} Dependencies installed"

# 2. Copy hook to project
mkdir -p "$PROJECT/.claude/hooks"
cp "$PLUGIN_DIR/scripts/send_event.py" "$PROJECT/.claude/hooks/send_event.py"
chmod +x "$PROJECT/.claude/hooks/send_event.py"
echo -e "${GREEN}✓${NC} Hook installed in $PROJECT/.claude/hooks/"

# 3. Merge settings.json
SETTINGS="$PROJECT/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  echo -e "${YELLOW}!${NC} Existing settings.json found — add hooks manually:"
  echo "  See: $PLUGIN_DIR/scripts/settings.json"
else
  cp "$PLUGIN_DIR/scripts/settings.json" "$SETTINGS"
  echo -e "${GREEN}✓${NC} Hooks registered in .claude/settings.json"
fi

# 4. Register MCP server in Claude Code config
CLAUDE_CONFIG="$HOME/.claude.json"
MCP_ENTRY=$(cat <<JSON
{
  "agent-office": {
    "command": "node",
    "args": ["$PLUGIN_DIR/mcp-server/index.js"],
    "type": "stdio"
  }
}
JSON
)

echo ""
echo -e "${BLUE}Almost done!${NC} Register the MCP server by adding this to ~/.claude.json"
echo "under the \"mcpServers\" key:"
echo ""
echo "$MCP_ENTRY"
echo ""
echo -e "${GREEN}✅ Installation complete!${NC}"
echo ""
echo "  Start Claude Code in $PROJECT and Agent Office will auto-launch."
echo "  Or open: http://localhost:4242"
echo ""
