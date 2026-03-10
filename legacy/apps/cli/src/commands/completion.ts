import type { Command } from "commander";
import { loadConfig } from "../lib/config";

export function registerCompletionCommands(program: Command): void {
  const completion = program.command("completion").description("Generate shell completion scripts");

  completion
    .command("bash")
    .description("Generate bash completion script")
    .action(() => {
      console.log(generateBashCompletion());
    });

  completion
    .command("zsh")
    .description("Generate zsh completion script")
    .action(() => {
      console.log(generateZshCompletion());
    });

  completion
    .command("fish")
    .description("Generate fish completion script")
    .action(() => {
      console.log(generateFishCompletion());
    });

  completion
    .command("powershell")
    .alias("pwsh")
    .description("Generate PowerShell completion script")
    .action(() => {
      console.log(generatePowerShellCompletion());
    });
}

function getProfileNames(): string[] {
  try {
    const config = loadConfig();
    return Object.keys(config.profiles);
  } catch {
    return ["default"];
  }
}

function generateBashCompletion(): string {
  return `# casfa bash completion
# Add this to ~/.bashrc:
#   eval "$(casfa completion bash)"
# Or:
#   casfa completion bash >> ~/.bashrc

_casfa_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="config auth info node depot realm cache completion"
    local config_cmds="init list set get use path create delete"
    local auth_cmds="login logout whoami status token"
    local auth_token_cmds="create list revoke set"
    local node_cmds="get put info cat exists"
    local depot_cmds="list create show commit update delete"
    local realm_cmds="info usage"
    local cache_cmds="stats clear path enable disable"
    local completion_cmds="bash zsh fish powershell"
    local formats="text json yaml table"

    case "\${words[1]}" in
        config)
            case "\${words[2]}" in
                use)
                    COMPREPLY=($(compgen -W "${getProfileNames().join(" ")}" -- "\${cur}"))
                    return
                    ;;
                *)
                    COMPREPLY=($(compgen -W "\${config_cmds}" -- "\${cur}"))
                    return
                    ;;
            esac
            ;;
        auth)
            case "\${words[2]}" in
                token)
                    COMPREPLY=($(compgen -W "\${auth_token_cmds}" -- "\${cur}"))
                    return
                    ;;
                *)
                    COMPREPLY=($(compgen -W "\${auth_cmds}" -- "\${cur}"))
                    return
                    ;;
            esac
            ;;
        node)
            COMPREPLY=($(compgen -W "\${node_cmds}" -- "\${cur}"))
            return
            ;;
        depot)
            COMPREPLY=($(compgen -W "\${depot_cmds}" -- "\${cur}"))
            return
            ;;
        realm)
            COMPREPLY=($(compgen -W "\${realm_cmds}" -- "\${cur}"))
            return
            ;;
        cache)
            COMPREPLY=($(compgen -W "\${cache_cmds}" -- "\${cur}"))
            return
            ;;
        completion)
            COMPREPLY=($(compgen -W "\${completion_cmds}" -- "\${cur}"))
            return
            ;;
        info)
            return
            ;;
    esac

    case "\${prev}" in
        -p|--profile)
            COMPREPLY=($(compgen -W "${getProfileNames().join(" ")}" -- "\${cur}"))
            return
            ;;
        -f|--format)
            COMPREPLY=($(compgen -W "\${formats}" -- "\${cur}"))
            return
            ;;
        -o|--output)
            _filedir
            return
            ;;
    esac

    if [[ "\${cur}" == -* ]]; then
        COMPREPLY=($(compgen -W "-p --profile --base-url --token --realm --no-cache -f --format -v --verbose -q --quiet -h --help --version" -- "\${cur}"))
        return
    fi

    COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
}

complete -F _casfa_completions casfa
`;
}

function generateZshCompletion(): string {
  return `#compdef casfa
# casfa zsh completion
# Add this to ~/.zshrc:
#   eval "$(casfa completion zsh)"
# Or save to a file in your $fpath

_casfa() {
    local -a commands
    commands=(
        'config:Manage CLI configuration'
        'auth:Authentication management'
        'info:Show service information'
        'node:Node operations'
        'depot:Depot management'
        'realm:Realm information'
        'cache:Local cache management'
        'completion:Generate shell completions'
    )

    local -a config_cmds
    config_cmds=(
        'init:Interactive configuration setup'
        'list:List all profiles'
        'set:Set a configuration value'
        'get:Get a configuration value'
        'use:Switch to a profile'
        'path:Show configuration file path'
        'create:Create a new profile'
        'delete:Delete a profile'
    )

    local -a auth_cmds
    auth_cmds=(
        'login:Login using device code flow'
        'logout:Clear stored credentials'
        'whoami:Show current user information'
        'status:Check authentication status'
        'token:Agent token management'
    )

    local -a node_cmds
    node_cmds=(
        'get:Download a node to a file'
        'put:Upload a file'
        'info:Show node metadata'
        'cat:Output node content to stdout'
        'exists:Check if nodes exist'
    )

    local -a depot_cmds
    depot_cmds=(
        'list:List all depots'
        'create:Create a new depot'
        'show:Show depot details'
        'commit:Commit a new root'
        'update:Update depot settings'
        'delete:Delete a depot'
    )

    local -a profiles
    profiles=(${getProfileNames().join(" ")})

    _arguments -C \\
        '-p[Use specified profile]:profile:($profiles)' \\
        '--profile[Use specified profile]:profile:($profiles)' \\
        '--base-url[Override service base URL]:url:' \\
        '--token[Use agent token]:token:' \\
        '--realm[Specify realm ID]:realm:' \\
        '--no-cache[Disable local cache]' \\
        '-f[Output format]:format:(text json yaml table)' \\
        '--format[Output format]:format:(text json yaml table)' \\
        '-v[Verbose output]' \\
        '--verbose[Verbose output]' \\
        '-q[Quiet mode]' \\
        '--quiet[Quiet mode]' \\
        '-h[Show help]' \\
        '--help[Show help]' \\
        '--version[Show version]' \\
        '1: :->command' \\
        '*:: :->args'

    case $state in
        command)
            _describe -t commands 'casfa command' commands
            ;;
        args)
            case $words[1] in
                config)
                    _describe -t config_cmds 'config command' config_cmds
                    ;;
                auth)
                    _describe -t auth_cmds 'auth command' auth_cmds
                    ;;
                node)
                    _describe -t node_cmds 'node command' node_cmds
                    ;;
                depot)
                    _describe -t depot_cmds 'depot command' depot_cmds
                    ;;
                realm)
                    _describe -t commands 'realm command' '(info usage)'
                    ;;
                cache)
                    _describe -t commands 'cache command' '(stats clear path enable disable)'
                    ;;
                completion)
                    _describe -t commands 'shell' '(bash zsh fish powershell)'
                    ;;
            esac
            ;;
    esac
}

_casfa "$@"
`;
}

function generateFishCompletion(): string {
  return `# casfa fish completion
# Save this to ~/.config/fish/completions/casfa.fish

# Disable file completion by default
complete -c casfa -f

# Global options
complete -c casfa -s p -l profile -d 'Use specified profile' -xa '${getProfileNames().join(" ")}'
complete -c casfa -l base-url -d 'Override service base URL'
complete -c casfa -l token -d 'Use agent token'
complete -c casfa -l realm -d 'Specify realm ID'
complete -c casfa -l no-cache -d 'Disable local cache'
complete -c casfa -s f -l format -d 'Output format' -xa 'text json yaml table'
complete -c casfa -s v -l verbose -d 'Verbose output'
complete -c casfa -s q -l quiet -d 'Quiet mode'
complete -c casfa -s h -l help -d 'Show help'
complete -c casfa -l version -d 'Show version'

# Main commands
complete -c casfa -n '__fish_use_subcommand' -a config -d 'Manage CLI configuration'
complete -c casfa -n '__fish_use_subcommand' -a auth -d 'Authentication management'
complete -c casfa -n '__fish_use_subcommand' -a info -d 'Show service information'
complete -c casfa -n '__fish_use_subcommand' -a node -d 'Node operations'
complete -c casfa -n '__fish_use_subcommand' -a depot -d 'Depot management'
complete -c casfa -n '__fish_use_subcommand' -a realm -d 'Realm information'
complete -c casfa -n '__fish_use_subcommand' -a cache -d 'Local cache management'
complete -c casfa -n '__fish_use_subcommand' -a completion -d 'Generate shell completions'

# config subcommands
complete -c casfa -n '__fish_seen_subcommand_from config' -a init -d 'Interactive configuration setup'
complete -c casfa -n '__fish_seen_subcommand_from config' -a list -d 'List all profiles'
complete -c casfa -n '__fish_seen_subcommand_from config' -a set -d 'Set a configuration value'
complete -c casfa -n '__fish_seen_subcommand_from config' -a get -d 'Get a configuration value'
complete -c casfa -n '__fish_seen_subcommand_from config' -a use -d 'Switch to a profile'
complete -c casfa -n '__fish_seen_subcommand_from config' -a path -d 'Show configuration file path'
complete -c casfa -n '__fish_seen_subcommand_from config' -a create -d 'Create a new profile'
complete -c casfa -n '__fish_seen_subcommand_from config' -a delete -d 'Delete a profile'

# auth subcommands
complete -c casfa -n '__fish_seen_subcommand_from auth' -a login -d 'Login using device code flow'
complete -c casfa -n '__fish_seen_subcommand_from auth' -a logout -d 'Clear stored credentials'
complete -c casfa -n '__fish_seen_subcommand_from auth' -a whoami -d 'Show current user information'
complete -c casfa -n '__fish_seen_subcommand_from auth' -a status -d 'Check authentication status'
complete -c casfa -n '__fish_seen_subcommand_from auth' -a token -d 'Agent token management'

# node subcommands
complete -c casfa -n '__fish_seen_subcommand_from node' -a get -d 'Download a node to a file'
complete -c casfa -n '__fish_seen_subcommand_from node' -a put -d 'Upload a file'
complete -c casfa -n '__fish_seen_subcommand_from node' -a info -d 'Show node metadata'
complete -c casfa -n '__fish_seen_subcommand_from node' -a cat -d 'Output node content to stdout'
complete -c casfa -n '__fish_seen_subcommand_from node' -a exists -d 'Check if nodes exist'

# depot subcommands
complete -c casfa -n '__fish_seen_subcommand_from depot' -a list -d 'List all depots'
complete -c casfa -n '__fish_seen_subcommand_from depot' -a create -d 'Create a new depot'
complete -c casfa -n '__fish_seen_subcommand_from depot' -a show -d 'Show depot details'
complete -c casfa -n '__fish_seen_subcommand_from depot' -a commit -d 'Commit a new root'
complete -c casfa -n '__fish_seen_subcommand_from depot' -a update -d 'Update depot settings'
complete -c casfa -n '__fish_seen_subcommand_from depot' -a delete -d 'Delete a depot'

# realm subcommands
complete -c casfa -n '__fish_seen_subcommand_from realm' -a info -d 'Show realm information'
complete -c casfa -n '__fish_seen_subcommand_from realm' -a usage -d 'Show storage usage'

# cache subcommands
complete -c casfa -n '__fish_seen_subcommand_from cache' -a stats -d 'Show cache statistics'
complete -c casfa -n '__fish_seen_subcommand_from cache' -a clear -d 'Clear all cached data'
complete -c casfa -n '__fish_seen_subcommand_from cache' -a path -d 'Show cache directory path'
complete -c casfa -n '__fish_seen_subcommand_from cache' -a enable -d 'Enable local caching'
complete -c casfa -n '__fish_seen_subcommand_from cache' -a disable -d 'Disable local caching'

# completion subcommands
complete -c casfa -n '__fish_seen_subcommand_from completion' -a bash -d 'Generate bash completion'
complete -c casfa -n '__fish_seen_subcommand_from completion' -a zsh -d 'Generate zsh completion'
complete -c casfa -n '__fish_seen_subcommand_from completion' -a fish -d 'Generate fish completion'
complete -c casfa -n '__fish_seen_subcommand_from completion' -a powershell -d 'Generate PowerShell completion'
`;
}

function generatePowerShellCompletion(): string {
  return `# casfa PowerShell completion
# Add this to your $PROFILE:
#   casfa completion powershell | Out-String | Invoke-Expression

$script:CasfaCommands = @(
    @{ Name = 'config'; Description = 'Manage CLI configuration' }
    @{ Name = 'auth'; Description = 'Authentication management' }
    @{ Name = 'info'; Description = 'Show service information' }
    @{ Name = 'node'; Description = 'Node operations' }
    @{ Name = 'depot'; Description = 'Depot management' }
    @{ Name = 'realm'; Description = 'Realm information' }
    @{ Name = 'cache'; Description = 'Local cache management' }
    @{ Name = 'completion'; Description = 'Generate shell completions' }
)

$script:CasfaSubCommands = @{
    'config' = @('init', 'list', 'set', 'get', 'use', 'path', 'create', 'delete')
    'auth' = @('login', 'logout', 'whoami', 'status', 'token')
    'node' = @('get', 'put', 'info', 'cat', 'exists')
    'depot' = @('list', 'create', 'show', 'commit', 'update', 'delete')
    'realm' = @('info', 'usage')
    'cache' = @('stats', 'clear', 'path', 'enable', 'disable')
    'completion' = @('bash', 'zsh', 'fish', 'powershell')
}

$script:CasfaProfiles = @(${getProfileNames()
    .map((p) => `'${p}'`)
    .join(", ")})
$script:CasfaFormats = @('text', 'json', 'yaml', 'table')

Register-ArgumentCompleter -CommandName casfa -Native -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $words = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
    $wordCount = $words.Count

    # Global options
    if ($wordToComplete -like '-*') {
        $options = @(
            @{ Name = '-p'; Description = 'Use specified profile' }
            @{ Name = '--profile'; Description = 'Use specified profile' }
            @{ Name = '--base-url'; Description = 'Override service base URL' }
            @{ Name = '--token'; Description = 'Use agent token' }
            @{ Name = '--realm'; Description = 'Specify realm ID' }
            @{ Name = '--no-cache'; Description = 'Disable local cache' }
            @{ Name = '-f'; Description = 'Output format' }
            @{ Name = '--format'; Description = 'Output format' }
            @{ Name = '-v'; Description = 'Verbose output' }
            @{ Name = '--verbose'; Description = 'Verbose output' }
            @{ Name = '-q'; Description = 'Quiet mode' }
            @{ Name = '--quiet'; Description = 'Quiet mode' }
            @{ Name = '-h'; Description = 'Show help' }
            @{ Name = '--help'; Description = 'Show help' }
            @{ Name = '--version'; Description = 'Show version' }
        )

        $options | Where-Object { $_.Name -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new(
                $_.Name,
                $_.Name,
                'ParameterName',
                $_.Description
            )
        }
        return
    }

    # Complete profile after -p or --profile
    $prevWord = if ($wordCount -gt 1) { $words[$wordCount - 2] } else { '' }
    if ($prevWord -eq '-p' -or $prevWord -eq '--profile') {
        $script:CasfaProfiles | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', "Profile: $_")
        }
        return
    }

    # Complete format after -f or --format
    if ($prevWord -eq '-f' -or $prevWord -eq '--format') {
        $script:CasfaFormats | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', "Format: $_")
        }
        return
    }

    # Find main command (skip options)
    $mainCmd = $null
    $subCmd = $null
    for ($i = 1; $i -lt $wordCount; $i++) {
        $word = $words[$i]
        if ($word -notlike '-*' -and $words[$i - 1] -notmatch '^(-p|--profile|-f|--format|--base-url|--token|--realm)$') {
            if ($null -eq $mainCmd) {
                $mainCmd = $word
            } elseif ($null -eq $subCmd) {
                $subCmd = $word
                break
            }
        }
    }

    # Complete main command
    if ($null -eq $mainCmd -or ($mainCmd -eq $wordToComplete -and $null -eq $subCmd)) {
        $script:CasfaCommands | Where-Object { $_.Name -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new(
                $_.Name,
                $_.Name,
                'Command',
                $_.Description
            )
        }
        return
    }

    # Complete subcommand
    if ($script:CasfaSubCommands.ContainsKey($mainCmd)) {
        $script:CasfaSubCommands[$mainCmd] | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'Command', "casfa $mainCmd $_")
        }
    }
}
`;
}
