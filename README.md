# Corben MCP Server

Give your AI agent superpowers. 220+ tools for building websites, sending email, managing contacts, invoicing, databases, automation, and more — all through one connection.

Works with **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**, and any MCP-compatible client.

## One-Line Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/gatordevin/corben-mcp/main/setup.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/gatordevin/corben-mcp/main/setup.ps1 | iex
```

This will:
1. Install the MCP server to `~/.corben-mcp`
2. Walk you through creating an account and getting an API key
3. Auto-detect your AI clients (Claude, Cursor, etc.)
4. Configure everything and connect

Or clone and run manually:

```bash
git clone https://github.com/gatordevin/corben-mcp.git
cd corben-mcp
npm install
./setup.sh          # macOS/Linux
.\setup.ps1         # Windows
```

## Give This to Your Agent

Paste this into any AI agent chat to set it up:

**macOS/Linux:**
```
Run this command to install Corben MCP tools:
curl -fsSL https://raw.githubusercontent.com/gatordevin/corben-mcp/main/setup.sh | bash
```

**Windows:**
```
Run this command in PowerShell to install Corben MCP tools:
iwr -useb https://raw.githubusercontent.com/gatordevin/corben-mcp/main/setup.ps1 | iex
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

This implements the security model recommended by [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html) for headless agent authentication:

### Hardware-Bound Identity

On first run, the server:
1. Reads your machine's **hardware UUID** (macOS IOPlatformUUID, Linux machine-id, Windows SMBIOS UUID)
2. Generates an **ECDSA P-256 keypair** — private key encrypted with a machine-derived AES-256-GCM key
3. **Registers the device** with the Corben API (public key + machine fingerprint)

The private key **never leaves the device** and **cannot be decrypted on another machine**.

### Challenge-Response Authentication

After initial registration, no secrets are sent over the wire:

```
1. Client sends key fingerprint → Server looks up device
2. Server sends random challenge (32 bytes)
3. Client signs challenge with ECDSA private key
4. Server verifies signature with registered public key
5. Server issues IP-bound session token (15 min TTL)
```

Even if someone intercepts all network traffic, they cannot authenticate without the hardware-bound private key.

### IP-Locked Tokens

Session tokens are bound to the client's IP address. If a token is used from a different IP:
- Token is **immediately invalidated**
- Event is logged to the device audit trail
- Client automatically re-authenticates

### Defense in Depth

| Layer | Protection |
|-------|-----------|
| **At rest** | API key + private key AES-256-GCM encrypted, tied to hardware UUID |
| **In transit** | HTTPS/TLS for all API communication |
| **Authentication** | ECDSA challenge-response (no secret over wire) |
| **Authorization** | 15-min session tokens, IP-locked, device-bound |
| **Revocation** | Instant device revoke from dashboard, audit log of all auth events |
| **Theft resistance** | Private key undecryptable on different hardware |

### Platform Support

| OS | Machine ID Source | Security Level |
|----|-------------------|---------------|
| macOS | `IOPlatformUUID` (hardware-fused) | High |
| Linux | `/etc/machine-id` or DMI `product_uuid` | Medium-High |
| Windows | `Win32_ComputerSystemProduct.UUID` (SMBIOS) | High |
| Fallback | SHA-256 of hostname + homedir | Medium |

---

## Manual Setup (if you skip the setup script)

### 1. Get an API Key

1. Go to [corben.world/signup](https://corben.world/signup) and create an account
2. Go to **Settings → API Keys**
3. Click **Create API Key**
4. Copy the key (starts with `cb_`)

### 2. Install

```bash
git clone https://github.com/gatordevin/corben-mcp.git ~/.corben-mcp
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
