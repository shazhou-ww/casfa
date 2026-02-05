# @casfa/cli

CLI for CASFA content-addressable storage service.

## Installation

```bash
# Install globally
bun add -g @casfa/cli

# Or use with bunx/npx
bunx @casfa/cli --help
```

## Quick Start

```bash
# Configure the CLI
casfa config init

# Login to CASFA
casfa auth login

# Check connection status
casfa info

# Upload a file
casfa node put ./myfile.txt

# Download a file
casfa node get node:abc123... -o output.txt
```

## Commands

### Configuration

```bash
# Initialize configuration
casfa config init

# Show current configuration
casfa config show

# Set configuration values
casfa config set baseUrl https://api.casfa.example.com
casfa config set profile default

# List all profiles
casfa config list
```

### Authentication

```bash
# Login via OAuth (browser-based)
casfa auth login

# Login with a specific profile
casfa auth login --profile production

# Check authentication status
casfa auth status

# Logout
casfa auth logout
```

### Node Operations (CAS)

```bash
# Upload a file
casfa node put <file>

# Upload from stdin
cat file.txt | casfa node put -

# Download a node
casfa node get <node-key> [-o output.txt]

# Check if node exists
casfa node has <node-key>

# Get node info
casfa node info <node-key>

# Upload a directory
casfa node put-tree <directory>

# Download a tree
casfa node get-tree <node-key> <output-dir>
```

### Depot Operations

```bash
# List depots
casfa depot list

# Create a depot
casfa depot create <name> [--description "..."]

# Get depot info
casfa depot info <depot-id>

# Update depot
casfa depot update <depot-id> --name "new-name"

# Delete depot
casfa depot delete <depot-id>

# Commit to depot
casfa depot commit <depot-id> <node-key>
```

### Ticket Operations

```bash
# List tickets
casfa ticket list [--depot <depot-id>]

# Create a ticket
casfa ticket create <depot-id> [--permissions read,write] [--expires-in 3600]

# Get ticket info
casfa ticket info <ticket-id>

# Revoke a ticket
casfa ticket revoke <ticket-id>
```

### Realm Operations

```bash
# Get realm info
casfa realm info

# List realm nodes
casfa realm nodes [--prefix <path>]
```

### Cache Operations

```bash
# Show cache info
casfa cache info

# Clear cache
casfa cache clear

# Prune expired items
casfa cache prune
```

### Shell Completion

```bash
# Generate completion script for bash
casfa completion bash >> ~/.bashrc

# Generate completion script for zsh
casfa completion zsh >> ~/.zshrc

# Generate completion script for fish
casfa completion fish >> ~/.config/fish/completions/casfa.fish
```

## Global Options

```bash
casfa [command] [options]

Options:
  -p, --profile <name>         Use specified profile
  --base-url <url>             Override service base URL
  --delegate-token <token>     Use delegate token for authentication
  --access-token <token>       Use access token directly
  --ticket <ticket>            Use ticket for authentication
  --realm <realm-id>           Specify realm ID
  --no-cache                   Disable local cache
  -f, --format <type>          Output format: text|json|yaml|table (default: "text")
  -v, --verbose                Verbose output
  -q, --quiet                  Quiet mode
  -V, --version                Output version number
  -h, --help                   Display help
```

## Configuration File

Configuration is stored in `~/.casfa/config.yaml`:

```yaml
currentProfile: default

profiles:
  default:
    baseUrl: https://api.casfa.example.com
    
  production:
    baseUrl: https://api.casfa.io
    
  local:
    baseUrl: http://localhost:8801
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CASFA_BASE_URL` | Override base URL |
| `CASFA_PROFILE` | Default profile name |
| `CASFA_TOKEN` | Delegate token for auth |
| `CASFA_ACCESS_TOKEN` | Access token for auth |
| `CASFA_CACHE_DIR` | Cache directory path |

## Examples

### Upload and share a file

```bash
# Upload a file
casfa node put document.pdf
# Output: node:abc123...

# Create a read-only ticket for sharing
casfa ticket create depot:xyz... --permissions read --expires-in 86400
# Output: ticket:def456...

# Share the ticket with others
echo "Access with: casfa node get node:abc123... --ticket ticket:def456..."
```

### Sync a directory to a depot

```bash
# Upload directory as a tree
casfa node put-tree ./project
# Output: node:abc123... (root node)

# Commit to depot
casfa depot commit depot:xyz... node:abc123...
```

### Use with different profiles

```bash
# Use production profile
casfa --profile production depot list

# Use local development server
casfa --base-url http://localhost:8801 info
```

## Development

```bash
# Run from source
bun run apps/cli/src/cli.ts --help

# Build
cd apps/cli && bun run build

# Run E2E tests
bun run test:e2e
```

## License

MIT
