# Corben MCP Server

Give your AI agent superpowers. 220+ tools for building websites, sending email, managing contacts, invoicing, databases, automation, and more — all through one connection.

Works with **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**, and any MCP-compatible client.

## One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/corben-world/corben-mcp/main/setup.sh | bash
```

This will:
1. Install the MCP server to `~/.corben-mcp`
2. Walk you through creating an account and getting an API key
3. Auto-detect your AI clients (Claude, Cursor, etc.)
4. Configure everything and connect

Or clone and run manually:

```bash
git clone https://github.com/corben-world/corben-mcp.git
cd corben-mcp
npm install
./setup.sh
```

## Give This to Your Agent

Paste this into any AI agent chat to set it up:

```
Run this command to install Corben MCP tools:
curl -fsSL https://raw.githubusercontent.com/corben-world/corben-mcp/main/setup.sh | bash
```

Or if the agent has terminal access, it can do it directly.

---

## What You Get

Once connected, your AI agent can:

| Category | What It Can Do |
|----------|---------------|
| **Websites** | Create, deploy, and manage full websites (drag-and-drop builder, templates, or custom code) |
| **Email** | Send/receive email, templates, campaigns, auto-rules |
| **Database** | Create tables, store data, key-value storage |
| **CRM** | Manage contacts, employees, businesses, sales pipelines |
| **Invoicing** | Create and send invoices, estimates, record payments |
| **Expenses** | Track expenses, generate P&L reports |
| **Calendar** | Events, booking pages, find open slots |
| **Phone/SMS** | Buy phone numbers, send texts |
| **Files** | Upload files, generate PDFs, image storage |
| **Products** | Product catalog, inventory tracking |
| **Forms** | Build forms, collect submissions |
| **Git** | Code repos, file management |
| **Domains** | Custom domains, DNS, domain email |
| **Automation** | Event triggers, webhooks, cron jobs, serverless functions |
| **AI Agents** | Create AI employees that handle tasks autonomously |
| **Payments** | Stripe checkout, payment tracking |
| **Analytics** | Site traffic, metrics, dashboards |
| **Web Browsing** | Fetch pages, search the web, take screenshots |

**220+ tools total** — the full list is dynamically loaded from the API.

---

## How It Works

```
Your AI ←→ MCP Protocol (stdio) ←→ Corben MCP Server ←→ HTTPS ←→ Corben API
```

The MCP server acts as a bridge. Your AI client talks to it over the standard MCP protocol, and it securely proxies requests to the Corben API.

---

## Security

- **Encrypted credentials** — API key is AES-256-GCM encrypted on disk, not plaintext
- **Session tokens** — Permanent key exchanged for 15-minute session tokens on startup
- **Auto-refresh** — Session tokens refresh automatically, permanent key used only once
- **HTTPS** — All API communication is TLS encrypted
- **Revocable** — Delete the key from your dashboard to instantly cut access

Your API key is **never** stored in plaintext config files.

---

## Manual Setup (if you skip the setup script)

### 1. Get an API Key

1. Go to [corben.world/signup](https://corben.world/signup) and create an account
2. Go to **Settings → API Keys**
3. Click **Create API Key**
4. Copy the key (starts with `cb_`)

### 2. Install

```bash
git clone https://github.com/corben-world/corben-mcp.git ~/.corben-mcp
cd ~/.corben-mcp
npm install
```

### 3. Save Your Key

```bash
node index.js --login
# Paste your API key when prompted
```

### 4. Connect to Your AI Client

**Claude Desktop** — Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "corben": {
      "command": "node",
      "args": ["~/.corben-mcp/index.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add corben -- node ~/.corben-mcp/index.js
```

**Cursor** — Settings → MCP Servers → Add:

```json
{
  "corben": {
    "command": "node",
    "args": ["~/.corben-mcp/index.js"]
  }
}
```

**Environment variable** (alternative, less secure):

```bash
export CORBEN_API_KEY=cb_your_key_here
node ~/.corben-mcp/index.js
```

---

## Managing Your Installation

```bash
# Update to latest version
cd ~/.corben-mcp && git pull && npm install

# Change API key
node ~/.corben-mcp/index.js --login

# Uninstall
rm -rf ~/.corben-mcp ~/.corben-mcp-credentials

# Check it works
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node ~/.corben-mcp/index.js 2>/dev/null
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No API key found` | Run `node ~/.corben-mcp/index.js --login` |
| `Could not decrypt credentials` | Credentials were made on a different machine. Re-run `--login` |
| `Token exchange failed` | Normal on first run if API hasn't deployed session tokens yet. Falls back to direct key (still encrypted over HTTPS) |
| Tools not appearing | Restart your AI client after setup |
| `ECONNREFUSED` | Check your internet connection / firewall |

## License

MIT
