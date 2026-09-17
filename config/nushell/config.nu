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
