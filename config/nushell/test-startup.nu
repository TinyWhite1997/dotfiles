# Run after installation: nu -n config/nushell/test-startup.nu
# Sourcing explicitly makes startup errors fail the test instead of opening a broken prompt.
source config.nu
use std/assert

let expected_root = if ('D:/' | path exists) {
  'D:/worktrees'
} else if ('Q:/' | path exists) {
  'Q:/worktrees'
} else {
  '~/worktrees' | path expand
}
assert equal $env.WORKTRUNK_WORKTREE_PATH $"($expected_root)/{{ repo }}/{{ branch | sanitize }}"
assert equal ($env.PROMPT_COMMAND | describe) 'closure'
assert equal ($env.PROMPT_COMMAND_RIGHT | describe) 'closure'
for item in [
  {name: l, expansion: 'eza -lh'}
  {name: ls, expansion: 'eza -lh'}
  {name: la, expansion: 'eza -lha'}
  {name: ll, expansion: 'eza -lh'}
] {
  assert equal (scope aliases | where name == $item.name | get expansion | first) $item.expansion
}
assert equal (which z | first | get type) 'alias'
assert equal (which zi | first | get type) 'alias'
print 'startup: configuration, worktree root, listing aliases, and zoxide loaded successfully'
