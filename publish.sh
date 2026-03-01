#!/bin/bash
# publish.sh - Creates GitHub repo and pushes everything
# Usage: ./publish.sh <github_username> <github_token> <repo_name>

set -e

USERNAME="${1}"
TOKEN="${2}"
REPO="${3:-agent-office}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$USERNAME" ] || [ -z "$TOKEN" ]; then
  echo "Usage: ./publish.sh <github_username> <github_token> [repo_name]"
  exit 1
fi

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}⬡ Publishing Agent Office to GitHub...${NC}"
echo "  User: $USERNAME"
echo "  Repo: $REPO"
echo ""

# 1. Patch README and demo with real URLs
DEMO_URL="https://${USERNAME}.github.io/${REPO}"
REPO_URL="https://github.com/${USERNAME}/${REPO}"

sed -i "s|https://YOUR_USERNAME.github.io/agent-office|${DEMO_URL}|g" "$DIR/README.md"
sed -i "s|YOUR_USERNAME/agent-office|${USERNAME}/${REPO}|g" "$DIR/README.md"
sed -i "s|href=\"#\"|href=\"${REPO_URL}\"|g" "$DIR/demo/index.html"

echo -e "${GREEN}✓${NC} URLs patched"

# 2. Create GitHub repo via API
echo "Creating GitHub repository..."
HTTP_STATUS=$(curl -s -o /tmp/gh_response.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  https://api.github.com/user/repos \
  -d "{
    \"name\": \"${REPO}\",
    \"description\": \"Real-time visualization of Claude Code agents — watch your AI work as a living office\",
    \"homepage\": \"${DEMO_URL}\",
    \"public\": true,
    \"has_issues\": true,
    \"has_wiki\": false
  }")

if [ "$HTTP_STATUS" = "422" ]; then
  echo -e "${GREEN}✓${NC} Repo already exists — pushing to existing repo"
elif [ "$HTTP_STATUS" = "201" ]; then
  echo -e "${GREEN}✓${NC} Repository created: ${REPO_URL}"
else
  echo "GitHub API response (${HTTP_STATUS}):"
  cat /tmp/gh_response.json
  exit 1
fi

# 3. Enable GitHub Pages via API
echo "Enabling GitHub Pages..."
curl -s -X POST \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/${USERNAME}/${REPO}/pages" \
  -d '{"source":{"branch":"main","path":"/"}}' > /dev/null 2>&1 || true

# 4. Init git and push
cd "$DIR"
git init -q
git config user.email "agent-office@publish"
git config user.name "Agent Office"
git add -A
git commit -q -m "🚀 Initial release — Agent Office v1.0

- Claude Code hook integration (SubagentStart/Stop, PreToolUse, PostToolUse)
- WebSocket server broadcasting real-time events to browser
- Animated agent office visualization UI
- Standalone GitHub Pages demo with simulation
- One-command installer"

git remote remove origin 2>/dev/null || true
git remote add origin "https://${USERNAME}:${TOKEN}@github.com/${USERNAME}/${REPO}.git"
git branch -M main
git push -u origin main -f -q

echo ""
echo -e "${GREEN}✓ Published successfully!${NC}"
echo ""
echo "  Repository: ${REPO_URL}"
echo "  Live demo:  ${DEMO_URL}"
echo "  (Demo deploys via GitHub Actions in ~60 seconds)"
echo ""
echo "  Next: star the repo and share it! ⭐"
echo ""
