let worktree_root = if ("D:/" | path exists) {
  "D:/worktrees"
} else if ("Q:/" | path exists) {
  "Q:/worktrees"
} else {
  $nu.home-path | path join "worktrees"
}
$env.WORKTRUNK_WORKTREE_PATH = $"($worktree_root)/{{ repo }}/{{ branch | sanitize }}"

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
