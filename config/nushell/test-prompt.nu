# Run after installation: nu -n config/nushell/test-prompt.nu
$env.HERDR_ENV = '0'
$env.USERNAME = $"prompt-test中文🙂(char nl)user"
# Shadow only the terminal-size query for deterministic resize/error checks.
def "term size" [] {
  let columns = $env.PROMPT_TEST_COLUMNS? | default 160
  if $columns < 0 { error make {msg: 'no terminal'} }
  {columns: $columns, rows: 30}
}
source config.nu
use std/assert

assert equal $env.config.render_right_prompt_on_last_line false
assert equal ($env.PROMPT_INDICATOR | ansi strip) 'λ '
assert equal $env.PROMPT_INDICATOR_VI_INSERT $env.PROMPT_INDICATOR
assert equal $env.PROMPT_INDICATOR_VI_NORMAL $env.PROMPT_INDICATOR
assert equal ($env.PROMPT_MULTILINE_INDICATOR | ansi strip) '··· '

# Rendering must work without executables.
for case in [
  {code: 0, elapsed: 499, status: '', duration: ''}
  {code: 42, elapsed: 500, status: ' exit 42', duration: '500ms'}
  {code: 1, elapsed: 1250, status: ' exit 1', duration: '1sec 250ms'}
] {
  with-env {PATH: [], LAST_EXIT_CODE: $case.code, CMD_DURATION_MS: ($case.elapsed | into string)} {
    let left = do $env.PROMPT_COMMAND
    let plain = $left | ansi strip
    assert equal ($plain | lines | length) 2
    assert ($plain | str starts-with '╭─ ')
    let cwd = $env.PWD | str replace --all '\' '/'
    assert ($plain | str ends-with $" ($cwd)($case.status) \n╰─")
    assert ($left | str ends-with (ansi reset))
    if $case.duration != '' {
      assert ($plain | str contains $" ($case.duration) ")
    } else {
      assert equal ($plain | split row '' | length) 2
    }
    let right = do $env.PROMPT_COMMAND_RIGHT | ansi strip
    assert equal ($right | lines | length) 1
    assert ($right | str contains ' prompt-test中文🙂user@')
    assert ($right =~ '^─* .*@.*  \d{2}:\d{2}:\d{2}, [ 0-9]\d  $')
  }
}
with-env {PATH: [], LAST_EXIT_CODE: 0, CMD_DURATION_MS: 0} {
  hide-env LAST_EXIT_CODE CMD_DURATION_MS
  cd $env.HOME
  let plain = do $env.PROMPT_COMMAND | ansi strip
  assert equal ($plain | lines | length) 2
  assert ($plain | str contains ($env.HOME | str replace --all '\' '/'))
  assert ($plain | str ends-with $"($env.HOME | str replace --all '\' '/') \n╰─")
}
# ANSI, wide characters, combining marks, exact fits, narrow screens, and no TTY.
with-env {PATH: [], PROMPT_COMMAND: { $"(ansi blue)╭─ 中文🙂é(ansi reset)\n╰─" }} {
  let left = do $env.PROMPT_COMMAND | ansi strip | lines | first
  let right = with-env {PROMPT_TEST_COLUMNS: 0} { do $env.PROMPT_COMMAND_RIGHT | ansi strip }
  let used = $"($left)($right)" | str stats | get unicode-width
  for columns in [-1 0 ($used - 1) $used ($used + 1) ($used + 40) 320] {
    with-env {PROMPT_TEST_COLUMNS: $columns} {
      let raw = do $env.PROMPT_COMMAND_RIGHT
      let plain = $raw | ansi strip
      let fill = $plain | split row '' | first
      assert ($fill =~ '^─*$')
      assert equal ($fill | str length --chars) ([0 ($columns - $used)] | math max)
      assert equal ($"($left)($plain)" | str stats | get unicode-width) ([$used $columns] | math max)
      if $columns > $used {
        assert ($raw | str starts-with $"(ansi reset)(ansi {fg: '#fb7e14'})─")
      }
      assert ($raw | str ends-with (ansi reset))
    }
  }
}
for closure in [$env.PROMPT_COMMAND $env.PROMPT_COMMAND_RIGHT] {
  assert not ((view source $closure) =~ '(?i)\bgit\b|\^|\bsys\b|\bopen\b|\bhttp\b|\bpath (exists|expand)\b')
}

# Informational only: machine load must not make this a flaky timing assertion.
let samples = 1..200 | each {
  timeit { do $env.PROMPT_COMMAND | ignore; do $env.PROMPT_COMMAND_RIGHT | ignore }
} | sort
print $"prompt: layout, status, duration, modes, sanitization, and no-executable checks passed; render median=($samples | math median), p95=($samples | get 189)"
