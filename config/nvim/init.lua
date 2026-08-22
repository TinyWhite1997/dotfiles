if vim.fn.has "nvim-0.12" ~= 1 then
  error "nvim-native requires Neovim 0.12 or newer"
end

vim.g.mapleader = " "
vim.g.maplocalleader = ","
vim.g.icons_enabled = true

-- yazi.nvim owns directory buffers in this config.
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1
vim.g.loaded_nvim_dir_plugin = 1

require "config.options"
require "config.autocmds"
require "config.keymaps"
require "config.platform"

local lazypath = vim.fn.stdpath "data" .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  local result = vim.fn.system {
    "git",
    "clone",
    "--filter=blob:none",
    "--branch=stable",
    "https://github.com/folke/lazy.nvim.git",
    lazypath,
  }
  if vim.v.shell_error ~= 0 then
    error("Failed to install lazy.nvim:\n" .. result)
  end
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({ { import = "plugins" } }, {
  change_detection = { notify = false },
  checker = { enabled = true, notify = false },
  install = { colorscheme = { "catppuccin", "habamax" } },
  ui = { backdrop = 100 },
  performance = {
    rtp = {
      disabled_plugins = { "gzip", "netrwPlugin", "tarPlugin", "tohtml", "zipPlugin" },
    },
  },
})
