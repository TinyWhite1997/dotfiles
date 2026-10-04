-- Pi's temporary prompt editor. Normal Neovim still uses its own init.lua.
if vim.fn.has "nvim-0.12" ~= 1 then
  error "Pi prompt editing requires Neovim 0.12 or newer"
end

vim.g.pi_prompt = true
vim.g.mapleader = " "
vim.g.maplocalleader = ","
vim.opt.loadplugins = false

-- Resolve the shared config from this file, not the user's Neovim config or cwd.
local source = vim.uv.fs_realpath(debug.getinfo(1, "S").source:sub(2))
local root = vim.fn.fnamemodify(source, ":h:h:h:h")
vim.opt.rtp:prepend(root .. "/config/nvim")

require "config.options"
require "config.autocmds"
require "config.keymaps"
require "config.platform"

-- Basic editing must work even when no optional plugins are installed.
vim.keymap.set("i", "jk", "<Esc>", { desc = "Exit insert mode" })
vim.keymap.set("i", "jj", "<Esc>", { desc = "Exit insert mode" })

-- No statusline plugin: keep the mode and command line visible.
vim.opt.showmode = true
vim.opt.cmdheight = 1
vim.opt.showtabline = 0
vim.opt.laststatus = 0
vim.cmd "filetype plugin indent on"
vim.cmd "syntax enable"

-- Reuse already-installed plugins, without loading Lazy or installing anything.
local function setup_plugin(name, module, opts)
  local path = vim.fn.stdpath "data" .. "/lazy/" .. name
  if not vim.uv.fs_stat(path) then
    return false
  end
  vim.opt.rtp:prepend(path)
  require(module).setup(opts)
  return true
end

if
  setup_plugin("catppuccin", "catppuccin", {
    flavour = "mocha",
    transparent_background = true,
    auto_integrations = false,
    default_integrations = false,
    compile_path = vim.fn.stdpath "cache" .. "/catppuccin-pi",
  })
then
  vim.cmd "colorscheme catppuccin"
else
  vim.cmd "colorscheme habamax"
end

setup_plugin("nvim-surround", "nvim-surround", {})
setup_plugin("nvim-autopairs", "nvim-autopairs", { check_ts = false, fast_wrap = {} })
