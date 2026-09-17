# Define the wrapper before sourcing upstream, so its completion functions use it.
let fzf_herdr_runner = $env.FILE_PWD | path join ../../herdr/plugins/fzf-popup/fzf.cjs | path expand

def --wrapped fzf [...args: string] {
  let input = $in
  if $input == null {
    ^node $fzf_herdr_runner ...$args
  } else {
    $input | ^node $fzf_herdr_runner ...$args
  }
}

source ($nu.default-config-dir | path join fzf.nu)

# Upstream keybindings launch an external executable; keep their quoting, history
# handling and editor updates, changing only the launcher. Outside Herdr, keep tmux too.
def __fzf_herdr_cmd [] {
  if ($env.HERDR_ENV? | default '0') == '1' {
    ['node' $fzf_herdr_runner]
  } else {
    __fzfcmd
  }
}
# Upstream joins argv for custom *_COMMAND pipelines through sh. Quote the
# launcher path there too (Windows backslashes, spaces and apostrophes).
def __fzf_herdr_shell_cmd [args: list<string>] {
  $args | each {|arg| "'" + ($arg | str replace --all "'" "'\\''") + "'" } | str join ' '
}
$env.config.keybindings = $env.config.keybindings | each {|binding|
  if $binding.name in [fzf_files fzf_history fzf_dirs] {
    $binding | update event {|binding|
      $binding.event | each {|event|
        $event | update cmd {|event|
          $event.cmd
          | str replace --all '__fzfcmd' '__fzf_herdr_cmd'
          | str replace "($fzfcmd | str join ' ')" "(__fzf_herdr_shell_cmd $fzfcmd)"
        }
      }
    }
  } else {
    $binding
  }
}
