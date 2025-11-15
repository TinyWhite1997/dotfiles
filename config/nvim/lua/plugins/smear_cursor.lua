if vim.g.neovide then return {} end
if vim.env.KITTY_WINDOW_ID then return {} end
if vim.env.GHOSTTY_RESOURCES_DIR then return {} end
return {
  "sphamba/smear-cursor.nvim",
  opts = {},
}
