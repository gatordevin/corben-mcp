#!/usr/bin/env bash
set -euo pipefail

# ─── Corben MCP Setup ────────────────────────────────────
# One command to install, authenticate, and connect Corben
# to your AI agent (Claude Desktop, Claude Code, Cursor).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/corben-world/corben-mcp/main/setup.sh | bash
#   OR
#   ./setup.sh
# ──────────────────────────────────────────────────────────

REPO_URL="https://github.com/gatordevin/corben-mcp.git"
INSTALL_DIR="$HOME/.corben-mcp"
CRED_FILE="$HOME/.corben-mcp-credentials"
API_URL="https://api.corben.world"
SIGNUP_URL="https://corben.world/signup"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

print_banner() {
  echo ""
  echo -e "${BLUE}${BOLD}╔══════════════════════════════════════╗${NC}"
  echo -e "${BLUE}${BOLD}║       Corben MCP Server Setup        ║${NC}"
  echo -e "${BLUE}${BOLD}║    220+ AI tools at your fingertips   ║${NC}"
  echo -e "${BLUE}${BOLD}╚══════════════════════════════════════╝${NC}"
  echo ""
}

check_deps() {
  local missing=()
  command -v node >/dev/null 2>&1 || missing+=("node")
  command -v npm >/dev/null 2>&1 || missing+=("npm")
  command -v git >/dev/null 2>&1 || missing+=("git")

  if [ ${#missing[@]} -gt 0 ]; then
    echo -e "${RED}Missing dependencies: ${missing[*]}${NC}"
    echo ""
    echo "Install Node.js: https://nodejs.org (v18+)"
    exit 1
  fi

  local node_version
  node_version=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$node_version" -lt 18 ]; then
    echo -e "${RED}Node.js v18+ required (you have $(node -v))${NC}"
    exit 1
  fi

  echo -e "${GREEN}✓${NC} Node.js $(node -v), npm $(npm -v), git $(git --version | cut -d' ' -f3)"
}

install_server() {
  if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Updating existing installation...${NC}"
    cd "$INSTALL_DIR"
    git pull --quiet origin main 2>/dev/null || true
  else
    echo "Cloning Corben MCP server..."
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  echo "Installing dependencies..."
  npm install --quiet --no-audit --no-fund 2>/dev/null
  echo -e "${GREEN}✓${NC} Server installed at $INSTALL_DIR"
}

get_api_key() {
  # Check if already authenticated
  if [ -f "$CRED_FILE" ]; then
    echo -e "${GREEN}✓${NC} Existing credentials found at $CRED_FILE"
    read -rp "Use existing credentials? [Y/n] " use_existing
    if [[ "$use_existing" =~ ^[Nn] ]]; then
      rm "$CRED_FILE"
    else
      return 0
    fi
  fi

  echo ""
  echo -e "${BOLD}Authentication${NC}"
  echo "─────────────────────────────────────"
  echo ""
  echo "You need a Corben API key (starts with cb_)."
  echo ""
  echo -e "  ${BLUE}1.${NC} Sign up or log in: ${BOLD}$SIGNUP_URL${NC}"
  echo -e "  ${BLUE}2.${NC} Go to Settings → API Keys"
  echo -e "  ${BLUE}3.${NC} Create a new API key"
  echo -e "  ${BLUE}4.${NC} Copy it and paste below"
  echo ""

  while true; do
    read -rsp "Paste your API key (hidden): " api_key
    echo ""

    if [[ ! "$api_key" =~ ^cb_ ]]; then
      echo -e "${RED}API key must start with cb_${NC}"
      continue
    fi

    if [ ${#api_key} -lt 20 ]; then
      echo -e "${RED}API key looks too short${NC}"
      continue
    fi

    # Verify key works
    echo -n "Verifying..."
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer $api_key" \
      "$API_URL/mcp" 2>/dev/null)

    if [ "$status" = "200" ]; then
      echo -e " ${GREEN}✓ Valid${NC}"
      break
    elif [ "$status" = "401" ]; then
      echo -e " ${RED}✗ Invalid key${NC}"
    else
      echo -e " ${YELLOW}✗ Could not reach API (status: $status)${NC}"
      read -rp "Save anyway? [y/N] " save_anyway
      if [[ "$save_anyway" =~ ^[Yy] ]]; then
        break
      fi
      continue
    fi
  done

  # Save encrypted via the MCP server's --login
  echo "$api_key" | node "$INSTALL_DIR/index.js" --login 2>/dev/null
  echo -e "${GREEN}✓${NC} API key encrypted and saved"
}

detect_clients() {
  local clients=()

  # Claude Desktop
  local claude_config=""
  if [ "$(uname)" = "Darwin" ]; then
    claude_config="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
  elif [ "$(uname)" = "Linux" ]; then
    claude_config="$HOME/.config/Claude/claude_desktop_config.json"
  fi
  if [ -n "$claude_config" ]; then
    clients+=("claude-desktop:$claude_config")
  fi

  # Claude Code
  if command -v claude >/dev/null 2>&1; then
    clients+=("claude-code:")
  fi

  # Cursor
  local cursor_config=""
  if [ "$(uname)" = "Darwin" ]; then
    cursor_config="$HOME/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/mcp.json"
  elif [ "$(uname)" = "Linux" ]; then
    cursor_config="$HOME/.config/Cursor/User/globalStorage/cursor.mcp/mcp.json"
  fi
  if [ -d "$(dirname "$cursor_config" 2>/dev/null)" ] 2>/dev/null; then
    clients+=("cursor:$cursor_config")
  fi

  echo "${clients[@]:-}"
}

configure_claude_desktop() {
  local config_path="$1"
  local config_dir
  config_dir=$(dirname "$config_path")

  mkdir -p "$config_dir"

  if [ -f "$config_path" ]; then
    # Check if corben already configured
    if grep -q '"corben"' "$config_path" 2>/dev/null; then
      echo -e "${GREEN}✓${NC} Claude Desktop already configured"
      return
    fi

    # Add to existing config using node
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$config_path', 'utf8'));
      if (!cfg.mcpServers) cfg.mcpServers = {};
      cfg.mcpServers.corben = {
        command: 'node',
        args: ['$INSTALL_DIR/index.js']
      };
      fs.writeFileSync('$config_path', JSON.stringify(cfg, null, 2) + '\n');
    "
  else
    cat > "$config_path" << JSONEOF
{
  "mcpServers": {
    "corben": {
      "command": "node",
      "args": ["$INSTALL_DIR/index.js"]
    }
  }
}
JSONEOF
  fi

  echo -e "${GREEN}✓${NC} Claude Desktop configured — restart it to activate"
}

configure_claude_code() {
  claude mcp add corben -- node "$INSTALL_DIR/index.js" 2>/dev/null
  echo -e "${GREEN}✓${NC} Claude Code configured — corben server added"
}

configure_cursor() {
  local config_path="$1"
  local config_dir
  config_dir=$(dirname "$config_path")

  mkdir -p "$config_dir"

  if [ -f "$config_path" ]; then
    if grep -q '"corben"' "$config_path" 2>/dev/null; then
      echo -e "${GREEN}✓${NC} Cursor already configured"
      return
    fi

    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$config_path', 'utf8'));
      cfg.corben = {
        command: 'node',
        args: ['$INSTALL_DIR/index.js']
      };
      fs.writeFileSync('$config_path', JSON.stringify(cfg, null, 2) + '\n');
    "
  else
    cat > "$config_path" << JSONEOF
{
  "corben": {
    "command": "node",
    "args": ["$INSTALL_DIR/index.js"]
  }
}
JSONEOF
  fi

  echo -e "${GREEN}✓${NC} Cursor configured — restart it to activate"
}

setup_clients() {
  echo ""
  echo -e "${BOLD}Connect to AI Clients${NC}"
  echo "─────────────────────────────────────"

  local clients
  clients=$(detect_clients)

  if [ -z "$clients" ]; then
    echo -e "${YELLOW}No supported AI clients detected.${NC}"
    echo ""
    echo "Manual setup — add this to your MCP client config:"
    echo ""
    echo -e "  ${BOLD}command:${NC} node"
    echo -e "  ${BOLD}args:${NC}    $INSTALL_DIR/index.js"
    echo ""
    return
  fi

  for entry in $clients; do
    local client="${entry%%:*}"
    local config="${entry#*:}"

    case "$client" in
      claude-desktop)
        read -rp "Configure Claude Desktop? [Y/n] " yn
        if [[ ! "$yn" =~ ^[Nn] ]]; then
          configure_claude_desktop "$config"
        fi
        ;;
      claude-code)
        read -rp "Configure Claude Code (CLI)? [Y/n] " yn
        if [[ ! "$yn" =~ ^[Nn] ]]; then
          configure_claude_code
        fi
        ;;
      cursor)
        read -rp "Configure Cursor? [Y/n] " yn
        if [[ ! "$yn" =~ ^[Nn] ]]; then
          configure_cursor "$config"
        fi
        ;;
    esac
  done
}

print_summary() {
  echo ""
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  Setup Complete!${NC}"
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}Server:${NC}      $INSTALL_DIR/index.js"
  echo -e "  ${BOLD}Credentials:${NC} $CRED_FILE (encrypted)"
  echo ""
  echo -e "  ${BOLD}Tools available:${NC} 220+ (sites, email, CRM,"
  echo "  invoicing, database, automation, and more)"
  echo ""
  echo "  Your AI agent now has access to all Corben tools."
  echo "  Just ask it to do things like:"
  echo ""
  echo -e "    ${BLUE}\"Create a website for my business\"${NC}"
  echo -e "    ${BLUE}\"Send an invoice to dave@example.com\"${NC}"
  echo -e "    ${BLUE}\"Set up a booking page for consultations\"${NC}"
  echo -e "    ${BLUE}\"Create a contact form and email me submissions\"${NC}"
  echo ""
  echo -e "  ${BOLD}Manage:${NC}"
  echo "    Update:     cd $INSTALL_DIR && git pull && npm install"
  echo "    New key:    node $INSTALL_DIR/index.js --login"
  echo "    Uninstall:  rm -rf $INSTALL_DIR $CRED_FILE"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────
main() {
  print_banner
  check_deps
  echo ""
  install_server
  echo ""
  get_api_key
  setup_clients
  print_summary
}

main "$@"
