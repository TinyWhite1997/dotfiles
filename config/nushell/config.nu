source ~/.zoxide.nu

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
