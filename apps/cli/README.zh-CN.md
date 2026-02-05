# @casfa/cli

CASFA 内容寻址存储服务的命令行工具。

## 安装

```bash
# 全局安装
bun add -g @casfa/cli

# 或者通过 bunx/npx 直接使用
bunx @casfa/cli --help
```

## 快速开始

```bash
# 初始化配置
casfa config init

# 登录 CASFA
casfa auth login

# 检查连接状态
casfa info

# 上传文件
casfa node put ./myfile.txt

# 下载文件
casfa node get node:abc123... -o output.txt
```

## 命令一览

### 配置管理

```bash
# 初始化配置
casfa config init

# 显示当前配置
casfa config show

# 设置配置项
casfa config set baseUrl https://api.casfa.example.com
casfa config set profile default

# 列出所有配置文件
casfa config list
```

### 身份认证

```bash
# 通过 OAuth 登录（浏览器方式）
casfa auth login

# 使用指定配置文件登录
casfa auth login --profile production

# 查看认证状态
casfa auth status

# 登出
casfa auth logout
```

### 节点操作（CAS）

```bash
# 上传文件
casfa node put <file>

# 从标准输入上传
cat file.txt | casfa node put -

# 下载节点
casfa node get <node-key> [-o output.txt]

# 检查节点是否存在
casfa node has <node-key>

# 获取节点信息
casfa node info <node-key>

# 上传目录
casfa node put-tree <directory>

# 下载目录树
casfa node get-tree <node-key> <output-dir>
```

### Depot 操作

```bash
# 列出 depot
casfa depot list

# 创建 depot
casfa depot create <name> [--description "..."]

# 获取 depot 信息
casfa depot info <depot-id>

# 更新 depot
casfa depot update <depot-id> --name "new-name"

# 删除 depot
casfa depot delete <depot-id>

# 向 depot 提交
casfa depot commit <depot-id> <node-key>
```

### Ticket 操作

```bash
# 列出 ticket
casfa ticket list [--depot <depot-id>]

# 创建 ticket
casfa ticket create <depot-id> [--permissions read,write] [--expires-in 3600]

# 获取 ticket 信息
casfa ticket info <ticket-id>

# 撤销 ticket
casfa ticket revoke <ticket-id>
```

### Realm 操作

```bash
# 获取 realm 信息
casfa realm info

# 列出 realm 节点
casfa realm nodes [--prefix <path>]
```

### 缓存操作

```bash
# 显示缓存信息
casfa cache info

# 清除缓存
casfa cache clear

# 清理过期缓存
casfa cache prune
```

### Shell 补全

```bash
# 生成 bash 补全脚本
casfa completion bash >> ~/.bashrc

# 生成 zsh 补全脚本
casfa completion zsh >> ~/.zshrc

# 生成 fish 补全脚本
casfa completion fish >> ~/.config/fish/completions/casfa.fish
```

## 全局选项

```bash
casfa [command] [options]

Options:
  -p, --profile <name>         使用指定的配置文件
  --base-url <url>             覆盖服务端基础 URL
  --delegate-token <token>     使用委托令牌进行认证
  --access-token <token>       直接使用访问令牌
  --ticket <ticket>            使用 ticket 进行认证
  --realm <realm-id>           指定 realm ID
  --no-cache                   禁用本地缓存
  -f, --format <type>          输出格式: text|json|yaml|table (默认: "text")
  -v, --verbose                详细输出
  -q, --quiet                  静默模式
  -V, --version                输出版本号
  -h, --help                   显示帮助信息
```

## 配置文件

配置存储在 `~/.casfa/config.yaml`：

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

## 环境变量

| 变量 | 说明 |
|------|------|
| `CASFA_BASE_URL` | 覆盖基础 URL |
| `CASFA_PROFILE` | 默认配置文件名 |
| `CASFA_TOKEN` | 用于认证的委托令牌 |
| `CASFA_ACCESS_TOKEN` | 用于认证的访问令牌 |
| `CASFA_CACHE_DIR` | 缓存目录路径 |

## 使用示例

### 上传并分享文件

```bash
# 上传文件
casfa node put document.pdf
# 输出: node:abc123...

# 创建只读 ticket 用于分享
casfa ticket create depot:xyz... --permissions read --expires-in 86400
# 输出: ticket:def456...

# 将 ticket 分享给他人
echo "使用以下命令访问: casfa node get node:abc123... --ticket ticket:def456..."
```

### 将目录同步到 depot

```bash
# 将目录上传为树
casfa node put-tree ./project
# 输出: node:abc123... (根节点)

# 提交到 depot
casfa depot commit depot:xyz... node:abc123...
```

### 使用不同的配置文件

```bash
# 使用生产环境配置
casfa --profile production depot list

# 使用本地开发服务器
casfa --base-url http://localhost:8801 info
```

## 开发

```bash
# 从源码运行
bun run apps/cli/src/cli.ts --help

# 构建
cd apps/cli && bun run build

# 运行端到端测试
bun run test:e2e
```

## 许可证

MIT
