-- This file simply bootstraps the installation of Lazy.nvim and then calls other files for execution
-- This file doesn't necessarily need to be touched, BE CAUTIOUS editing this file and proceed at your own risk.
local lazypath = vim.env.LAZY or vim.fn.stdpath "data" .. "/lazy/lazy.nvim"

if not (vim.env.LAZY or (vim.uv or vim.loop).fs_stat(lazypath)) then
  -- stylua: ignore
  local result = vim.fn.system({ "git", "clone", "--filter=blob:none", "https://github.com/folke/lazy.nvim.git", "--branch=stable", lazypath })
  if vim.v.shell_error ~= 0 then
    -- stylua: ignore
    vim.api.nvim_echo({ { ("Error cloning lazy.nvim:\n%s\n"):format(result), "ErrorMsg" }, { "Press any key to exit...", "MoreMsg" } }, true, {})
    vim.fn.getchar()
    vim.cmd.quit()
  end
end

vim.opt.rtp:prepend(lazypath)

-- validate that lazy is available
if not pcall(require, "lazy") then
  -- stylua: ignore
  vim.api.nvim_echo({ { ("Unable to load lazy from: %s\n"):format(lazypath), "ErrorMsg" }, { "Press any key to exit...", "MoreMsg" } }, true, {})
  vim.fn.getchar()
  vim.cmd.quit()
end

vim.api.nvim_set_hl(0, "RenderMarkdownH1", { bg = "#ffd6cc", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH2", { bg = "#e0f2fe", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH3", { bg = "#d5f5e3", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH4", { bg = "#fdebd0", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH5", { bg = "#e8daef", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH6", { bg = "#f2f3f4", bold = true })
vim.api.nvim_set_hl(0, "@markup.heading.1.markdown", { link = "RenderMarkdownH1" })
vim.api.nvim_set_hl(0, "@markup.heading.2.markdown", { link = "RenderMarkdownH2" })
vim.api.nvim_set_hl(0, "@markup.heading.3.markdown", { link = "RenderMarkdownH3" })
vim.api.nvim_set_hl(0, "@markup.heading.4.markdown", { link = "RenderMarkdownH4" })
vim.api.nvim_set_hl(0, "@markup.heading.5.markdown", { link = "RenderMarkdownH5" })
vim.api.nvim_set_hl(0, "@markup.heading.6.markdown", { link = "RenderMarkdownH6" })
vim.api.nvim_set_hl(0, "RenderMarkdownH1Bg", { bg = "#8c3c2d", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH2Bg", { bg = "#0b4d80", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH3Bg", { bg = "#1c553b", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH4Bg", { bg = "#7e6000", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH5Bg", { bg = "#4a235a", bold = true })
vim.api.nvim_set_hl(0, "RenderMarkdownH6Bg", { bg = "#566573", bold = true })

require "lazy_setup"
if vim.fn.has "win32" == 1 or vim.fn.has "win64" == 1 then
  local powershell_options = {
    shell = vim.fn.executable "pwsh" == 1 and "pwsh" or "powershell",
    shellcmdflag = "-NoLogo -NoProfile -ExecutionPolicy RemoteSigned -Command [Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;",
    shellredir = "-RedirectStandardOutput %s -NoNewWindow -Wait",
    shellpipe = "2>&1 | Out-File -Encoding UTF8 %s; exit $LastExitCode",
    shellquote = "",
    shellxquote = "",
  }

  for option, value in pairs(powershell_options) do
    vim.opt[option] = value
  end
end

if vim.g.neovide then
  vim.g.neovide_cursor_vfx_mode = "railgun"
  vim.g.neovide_fullscreen = true
  vim.g.neovide_text_gamma = 0.8
  vim.g.neovide_text_contrast = 0.1
  vim.g.neovide_refresh_rate = 60
  vim.g.neovide_refresh_rate_idle = 5
  vim.keymap.set("v", "<D-c>", '"+y') -- Copy
  vim.keymap.set("n", "<D-v>", '"+P') -- Paste normal mode
  vim.keymap.set("v", "<D-v>", '"+P') -- Paste visual mode
  vim.keymap.set("c", "<D-v>", "<C-R>+") -- Paste command mode
  vim.keymap.set("i", "<D-v>", '<ESC>l"+Pli') -- Paste insert mode
  vim.keymap.set("t", "<D-v>", '<C-\\><C-n>"+Pa') -- Paste insert mode
end
vim.api.nvim_set_keymap("", "<D-v>", "+p<CR>", { noremap = true, silent = true })
vim.api.nvim_set_keymap("!", "<D-v>", "<C-R>+", { noremap = true, silent = true })
-- vim.api.nvim_set_keymap("t", "<D-v>", "<C-R>+", { noremap = true, silent = true })
vim.api.nvim_set_keymap("v", "<D-v>", "<C-R>+", { noremap = true, silent = true })
vim.lsp.enable "roslyn_lsp"

require "polish"
