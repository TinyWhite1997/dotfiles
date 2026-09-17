let worktree_root = if ("D:/" | path exists) {
  "D:/worktrees"
} else if ("Q:/" | path exists) {
  "Q:/worktrees"
} else {
  $nu.home-path | path join "worktrees"
}
$env.WORKTRUNK_WORKTREE_PATH = $"($worktree_root)/{{ repo }}/{{ branch | sanitize }}"

# The installer generates fzf.nu; fzf-herdr.nu loads it with the popup adapter.
# Keep the themes and shortcut options from zsh/fzf.zsh, with Windows-safe previews.
$env.FZF_DEFAULT_OPTS = r#'
  --tmux 80%
  --layout=reverse
  --border
  --walker-skip=.git,node_modules,.venv,target
  --color=bg+:#3c3836,bg:#32302f,spinner:#fb4934,hl:#928374,fg:#ebdbb2,header:#928374,info:#8ec07c,pointer:#fb4934,marker:#fb4934,fg+:#ebdbb2,prompt:#fb4934,hl+:#fb4934
'#
$env.FZF_CTRL_T_OPTS = r#'
  --walker=file,follow,hidden
  --color=bg+:#3B4252,bg:#2E3440,spinner:#81A1C1,hl:#616E88,fg:#D8DEE9,header:#616E88,info:#81A1C1,pointer:#81A1C1,marker:#81A1C1,fg+:#D8DEE9,prompt:#81A1C1,hl+:#81A1C1
  --preview 'bat --color=always --style=numbers --line-range :500 -- {}'
'#
$env.FZF_CTRL_R_OPTS = r#'
  --bind 'ctrl-y:execute-silent(powershell -NoProfile -Command "Set-Clipboard -Value $env:FZF_CURRENT_ITEM")+abort'
  --bind '?:toggle-preview'
  --preview 'nu -n -c "print $env.FZF_CURRENT_ITEM"'
  --preview-window down:3:hidden:wrap
  --color=header:italic,bg+:#3F3F3F,bg:#4B4B4B,border:#6B6B6B,spinner:#98BC99,hl:#719872,fg:#D9D9D9,header:#719872,info:#BDBB72,pointer:#E12672,marker:#E17899,fg+:#D9D9D9,preview-bg:#3F3F3F,prompt:#98BEDE,hl+:#98BC99
  --header 'Ctrl-Y: Copy command to clipboard; ALT-R: Raw mode; ?: Toggle preview'
'#
$env.FZF_ALT_C_OPTS = r#'
  --color=bg+:#3B4252,bg:#2E3440,spinner:#81A1C1,hl:#616E88,fg:#D8DEE9,header:#616E88,info:#81A1C1,pointer:#81A1C1,marker:#81A1C1,fg+:#D8DEE9,prompt:#81A1C1,hl+:#81A1C1
  --preview 'nu -n -c "eza --tree --color=always -- $env.FZF_CURRENT_ITEM | lines | first 200 | str join (char nl)"'
'#
$env.FZF_COMPLETION_TRIGGER = 'jj'

source ($nu.config-path | path expand | path dirname | path join fzf-herdr.nu)
source ~/.zoxide.nu
source ~/.worktrunk.nu
alias wt = git-wt

def "herdr switch" [
  --create (-c)
  branch: string
] {
  if $create {
    ^git-wt switch -c $branch --no-cd
  } else {
    ^git-wt switch $branch --no-cd
  }

  if $env.LAST_EXIT_CODE == 0 {
    ^herdr worktree open --cwd $env.PWD --branch $branch --focus
  }
}

def --wrapped lg [...args] {
  ^lazygit ...$args
}

def --env y [...args] {
  let tmp = (mktemp -t "yazi-cwd.XXXXXX")
  ^yazi ...$args --cwd-file $tmp
  let cwd = (open $tmp)
  if $cwd != $env.PWD and ($cwd | path exists) {
    cd $cwd
  }
  rm -fp $tmp
}

alias l = eza -lh
alias ls = eza -lh
alias la = eza -lha
alias ll = eza -lh

# Inspired by Oh My Posh's lambdageneration: https://ohmyposh.dev/docs/themes#lambdageneration
# Native rendering only: no Git, battery polling, filesystem probes, or child processes.
let prompt_frame = $"(ansi reset)(ansi {fg: '#fb7e14'})"
let prompt_edge = $"(ansi reset)(ansi {fg: '#292929'})"
let prompt_bar = ansi {fg: '#fb7e14', bg: '#292929'}
let prompt_lambda = ansi {fg: '#292929', bg: '#fb7e14'}
let prompt_os = match $nu.os-info.name {
  windows => ''
  macos => ''
  _ => ''
}
let prompt_user = $env.USERNAME? | default ($env.USER? | default '')
let prompt_host = $env.COMPUTERNAME? | default ($env.HOSTNAME? | default $nu.os-info.name)
let prompt_session = $"($prompt_user)@($prompt_host)" | str replace --all --regex '[\x00-\x1f\x7f-\x9f]' ''

$env.PROMPT_COMMAND = {
  let code = $env.LAST_EXIT_CODE? | default 0 | into int
  let elapsed = $env.CMD_DURATION_MS? | default 0 | into int
  let duration = if $elapsed >= 500 { $" ($elapsed * 1ms) " } else { '' }
  let cwd = $env.PWD | str replace --all '\' '/' | str replace --all --regex '[\x00-\x1f\x7f-\x9f]' ''
  let status = if $code == 0 { '' } else { $" exit ($code)" }
  $"($prompt_frame)╭─($prompt_edge)($prompt_bar) ($prompt_os) ($duration) ($cwd)($status) ($prompt_edge)(ansi reset)\n($prompt_frame)╰─(ansi reset)"
}
$env.PROMPT_COMMAND_RIGHT = {
  let right = $"($prompt_edge)($prompt_bar) ($prompt_session)  (date now | format date '%H:%M:%S, %e')  ($prompt_edge)(ansi reset)"
  let left_width = do $env.PROMPT_COMMAND | ansi strip | lines | first | str stats | get unicode-width
  let right_width = $right | ansi strip | str stats | get unicode-width
  let gap = (try { (term size).columns } catch { 0 }) - $left_width - $right_width
  # Keep the fill in the right prompt so Reedline hides it if the window is too narrow.
  if $gap > 0 {
    let line = '' | fill --character '─' --width $gap
    $"($prompt_frame)($line)($right)"
  } else {
    $right
  }
}
$env.config.render_right_prompt_on_last_line = false
$env.PROMPT_INDICATOR = $"($prompt_frame)($prompt_lambda)λ($prompt_frame)(ansi reset) "
$env.PROMPT_INDICATOR_VI_INSERT = $env.PROMPT_INDICATOR
$env.PROMPT_INDICATOR_VI_NORMAL = $env.PROMPT_INDICATOR
$env.PROMPT_MULTILINE_INDICATOR = $"($prompt_frame)··· (ansi reset)"
