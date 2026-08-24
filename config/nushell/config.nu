source ~/.zoxide.nu

def --wrapped lg [...args] {
  with-env { PATH: ($env.PATH | prepend 'C:\Program Files\Git\cmd') } {
    ^lazygit ...$args
  }
}
