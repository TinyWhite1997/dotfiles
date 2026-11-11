# A kept Herdr app terminal comes back as its shell after a machine restart.
# If Pi did not exit normally, its extension leaves the exact session on that terminal.
def __herdr_pi_restore_target [terminal: record] {
  let labels = $terminal.labels? | default {}
  let path = $labels."herdr.pi.session_path"? | default ''
  if ($path | is-empty) { return null }
  {
    path: $path
    cwd: ($labels."herdr.pi.session_cwd"? | default '')
  }
}

def __herdr_restore_pi_session [] {
  let terminal_id = $env.HC_TERMINAL_ID? | default ''
  if ($terminal_id | is-empty) or not ($env.PI_SESSION_ID? | default '' | is-empty) { return }

  let result = (^hc get $terminal_id --json | complete)
  if $result.exit_code != 0 { return }

  let target = (__herdr_pi_restore_target ($result.stdout | from json))
  if $target == null { return }
  if not ($target.cwd | is-empty) { cd $target.cwd }
  ^pi --session $target.path
}

if $nu.is-interactive {
  __herdr_restore_pi_session
}
