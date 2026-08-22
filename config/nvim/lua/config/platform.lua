local sysname = (vim.uv or vim.loop).os_uname().sysname

if sysname == "Windows_NT" then
  local shell = vim.fn.executable "pwsh" == 1 and "pwsh" or "powershell"
  vim.opt.shell = shell
  vim.opt.shellcmdflag =
    "-NoLogo -NoProfile -ExecutionPolicy RemoteSigned -Command [Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;"
  vim.opt.shellredir = "-RedirectStandardOutput %s -NoNewWindow -Wait"
  vim.opt.shellpipe = "2>&1 | Out-File -Encoding UTF8 %s; exit $LastExitCode"
  vim.opt.shellquote = ""
  vim.opt.shellxquote = ""
end

if not vim.g.neovide then
  return
end

vim.g.neovide_cursor_vfx_mode = "railgun"
vim.g.neovide_macos_simple_fullscreen = true
vim.g.neovide_text_gamma = 0.8
vim.g.neovide_text_contrast = 0.1
vim.g.neovide_refresh_rate = 60
vim.g.neovide_refresh_rate_idle = 5
vim.g.neovide_window_blurred = true
vim.g.neovide_floating_blur_amount_x = 2.0
vim.g.neovide_floating_blur_amount_y = 2.0
vim.g.neovide_floating_shadow = true
vim.g.neovide_floating_z_height = 10
vim.g.neovide_light_angle_degrees = 45
vim.g.neovide_light_radius = 5
vim.g.neovide_hide_mouse_when_typing = false
vim.g.neovide_input_macos_option_key_is_meta = "only_left"
vim.g.neovide_input_ime = false
vim.g.neovide_cursor_animate_in_insert_mode = true
vim.g.neovide_cursor_animate_command_line = true
vim.g.neovide_cursor_smooth_blink = true
if sysname == "Darwin" then
  vim.g.neovide_opacity = 0.9
end

local mod = sysname == "Darwin" and "D" or "C"
vim.keymap.set("v", "<" .. mod .. "-c>", '"+y')
vim.keymap.set("n", "<" .. mod .. "-v>", '"+P')
vim.keymap.set("v", "<" .. mod .. "-v>", '"+P')
vim.keymap.set("c", "<" .. mod .. "-v>", "<C-R>+")
vim.keymap.set("i", "<" .. mod .. "-v>", '<Esc>l"+Pli')
vim.keymap.set("t", "<" .. mod .. "-v>", '<C-\\><C-n>"+Pa')
