# Run after installation: nu -n config/nushell/test-fzf.nu
$env.HERDR_ENV = '0' # Unit checks must not open interactive windows.
source config.nu
use std/assert

let bindings = $env.config.keybindings | where name starts-with 'fzf_'
assert equal ($bindings | select name modifier keycode | sort-by name) [
  {name: fzf_dirs, modifier: alt, keycode: char_c}
  {name: fzf_files, modifier: control, keycode: char_t}
  {name: fzf_history, modifier: control, keycode: char_r}
]
for binding in $bindings {
  assert ('emacs' in $binding.mode and 'vi_insert' in $binding.mode)
  assert equal $binding.event.0.send executehostcommand
  assert ($binding.event.0.cmd | str contains '__fzf_herdr_cmd')
}
assert $env.config.completions.external.enable
assert equal $env.FZF_COMPLETION_TRIGGER 'jj'
assert equal (do $env.config.completions.external.completer ['git' 'status']) null
with-env {
  FZF_COMPLETERS: {fzf-probe: {|prefix, spans| [alpha beta]}}
  FZF_COMPLETION_OPTS: '--filter=alpha'
} {
  assert equal (do $env.config.completions.external.completer ['fzf-probe' 'ajj']) [alpha]
}

# Keep all four palettes in sync with the original Zsh configuration, and let
# the real binary validate each shortcut's options without needing a TTY.
let original = open --raw ($env.FILE_PWD | path join ../../zsh/fzf.zsh)
for name in [FZF_DEFAULT_OPTS FZF_CTRL_T_OPTS FZF_CTRL_R_OPTS FZF_ALT_C_OPTS] {
  let old_opts = $original | parse --regex ('(?s)export ' + $name + '="(?<opts>.*?)"') | get 0.opts
  let color = $old_opts | parse --regex '--color=(?<color>\S+)' | get 0.color
  let opts = $env | get $name
  assert ($opts | str contains $'--color=($color)')
  let result = [alpha beta] | str join (char nl) | with-env {
    FZF_DEFAULT_OPTS: $'($env.FZF_DEFAULT_OPTS) ($opts)'
  } { fzf --filter alpha | str trim }
  assert equal $result alpha
}
let paths = ['C:\space & 日本語\file.txt' "quote's.txt"]
let shell_command = __fzf_herdr_shell_cmd ['printf' '%s\0' ...$paths]
assert equal (^sh -c $shell_command | split row (char nul) | where $it != '') $paths
print 'fzf: bindings, original themes, completion, option parsing, and shell quoting passed'
