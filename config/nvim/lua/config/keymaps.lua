local map = vim.keymap.set
local utils = require "config.utils"

map("", "<Space>", "<Nop>", { silent = true })

-- AstroNvim core mappings, then existing local overrides.
map({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true, desc = "Move down" })
map({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true, desc = "Move up" })
map("n", "<Leader>w", "<Cmd>w<CR>", { desc = "Save" })
map("n", "<Leader>q", "<Cmd>confirm q<CR>", { desc = "Quit window" })
map("n", "<Leader>Q", "<Cmd>confirm qall<CR>", { desc = "Exit Neovim" })
map("n", "<Leader>n", "<Cmd>enew<CR>", { desc = "New file" })
map("n", "<C-S>", "<Cmd>silent! update! | redraw<CR>", { desc = "Force write" })
map("n", "<C-Q>", "<Cmd>q!<CR>", { desc = "Force quit" })
map("n", "|", "<Cmd>vsplit<CR>", { desc = "Vertical split" })
map("n", "\\", "<Cmd>split<CR>", { desc = "Horizontal split" })
map("n", "<Leader>/", "gcc", { remap = true, desc = "Toggle comment line" })
map("x", "<Leader>/", "gc", { remap = true, desc = "Toggle comment" })
map("n", "gco", "o<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add comment below" })
map("n", "gcO", "O<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add comment above" })

map("n", "]b", "<Cmd>bnext<CR>", { desc = "Next buffer" })
map("n", "[b", "<Cmd>bprevious<CR>", { desc = "Previous buffer" })
map("n", "<Leader>c", "<Cmd>bdelete<CR>", { desc = "Close buffer" })
map("n", "<Leader>C", "<Cmd>bdelete!<CR>", { desc = "Force close buffer" })
map("n", "<Leader>bc", function()
  local current = vim.api.nvim_get_current_buf()
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if buf ~= current and vim.bo[buf].buflisted then
      pcall(vim.api.nvim_buf_delete, buf, {})
    end
  end
end, { desc = "Close other buffers" })
map("n", "<Leader>bb", function()
  Snacks.picker.buffers()
end, { desc = "Find buffers" })

map("n", "]t", "<Cmd>tabnext<CR>", { desc = "Next tab" })
map("n", "[t", "<Cmd>tabprevious<CR>", { desc = "Previous tab" })
map("n", "<C-H>", "<C-w>h", { desc = "Left split" })
map("n", "<C-J>", "<C-w>j", { desc = "Below split" })
map("n", "<C-K>", "<C-w>k", { desc = "Above split" })
map("n", "<C-L>", "<C-w>l", { desc = "Right split" })
map("n", "<C-Up>", "<Cmd>resize -2<CR>", { desc = "Resize up" })
map("n", "<C-Down>", "<Cmd>resize +2<CR>", { desc = "Resize down" })
map("n", "<C-Left>", "<Cmd>vertical resize -2<CR>", { desc = "Resize left" })
map("n", "<C-Right>", "<Cmd>vertical resize +2<CR>", { desc = "Resize right" })
map("t", "<C-;>", "<C-\\><C-n>", { desc = "Terminal normal mode" })

map("n", "<Leader>xq", "<Cmd>copen<CR>", { desc = "Quickfix list" })
map("n", "<Leader>xl", "<Cmd>lopen<CR>", { desc = "Location list" })
map("x", "<S-Tab>", "<gv", { desc = "Unindent line" })
map("x", "<Tab>", ">gv", { desc = "Indent line" })

local function diagnostic_jump(count, severity)
  return function()
    vim.diagnostic.jump { count = count * vim.v.count1, severity = severity }
  end
end
map("n", "[e", diagnostic_jump(-1, vim.diagnostic.severity.ERROR), { desc = "Previous error" })
map("n", "]e", diagnostic_jump(1, vim.diagnostic.severity.ERROR), { desc = "Next error" })
map("n", "[w", diagnostic_jump(-1, vim.diagnostic.severity.WARN), { desc = "Previous warning" })
map("n", "]w", diagnostic_jump(1, vim.diagnostic.severity.WARN), { desc = "Next warning" })
map("n", "gl", vim.diagnostic.open_float, { desc = "Hover diagnostics" })
map("n", "<Leader>ld", vim.diagnostic.open_float, { desc = "Hover diagnostics" })

map("n", "<Leader>pi", function()
  require("lazy").install()
end, { desc = "Plugins install" })
map("n", "<Leader>ps", function()
  require("lazy").home()
end, { desc = "Plugins status" })
map("n", "<Leader>pS", function()
  require("lazy").sync()
end, { desc = "Plugins sync" })
map("n", "<Leader>pu", function()
  require("lazy").check()
end, { desc = "Plugins check updates" })
map("n", "<Leader>pU", function()
  require("lazy").update()
end, { desc = "Plugins update" })
map("n", "<Leader>pm", "<Cmd>Mason<CR>", { desc = "Mason" })
map("n", "<Leader>pM", "<Cmd>MasonToolsUpdate<CR>", { desc = "Mason tools update" })

map("n", "<Leader>ub", function()
  vim.o.background = vim.o.background == "dark" and "light" or "dark"
  vim.notify("background: " .. vim.o.background)
end, { desc = "Toggle background" })
map("n", "<Leader>ud", function()
  vim.diagnostic.enable(not vim.diagnostic.is_enabled())
end, { desc = "Toggle diagnostics" })
map("n", "<Leader>un", function()
  if vim.wo.number and vim.wo.relativenumber then
    vim.wo.relativenumber = false
  elseif vim.wo.number then
    vim.wo.number = false
  else
    vim.wo.number, vim.wo.relativenumber = true, true
  end
end, { desc = "Change line numbering" })
map("n", "<Leader>us", function()
  utils.toggle_option "spell"
end, { desc = "Toggle spellcheck" })
map("n", "<Leader>uw", function()
  utils.toggle_option "wrap"
end, { desc = "Toggle wrap" })
map("n", "<Leader>uv", function()
  local config = vim.diagnostic.config()
  vim.diagnostic.config { virtual_text = not config.virtual_text }
end, { desc = "Toggle virtual text" })
map("n", "<Leader>uV", function()
  local config = vim.diagnostic.config()
  vim.diagnostic.config { virtual_lines = not config.virtual_lines }
end, { desc = "Toggle virtual lines" })

-- Existing local mappings.
map("n", "<Leader>,", "mzA,<Esc>`z")
map("n", "<Leader>;", "mzA;<Esc>`z")
map("n", "J", "5j")
map("n", "K", "5k")
map("n", "H", "0")
map("n", "L", "$")
map("x", "J", "5j")
map("x", "K", "5k")
map("x", "H", "0")
map("x", "L", "$")
map("n", "<Leader><Leader>mo", function()
  require("render-markdown").enable()
end, { desc = "Enable Markdown render" })
map("n", "<Leader><Leader>mc", function()
  require("render-markdown").disable()
end, { desc = "Disable Markdown render" })
