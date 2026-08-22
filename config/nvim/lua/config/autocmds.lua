local utils = require "config.utils"
local group = vim.api.nvim_create_augroup("native_config", { clear = true })

vim.api.nvim_create_autocmd("TextYankPost", {
  group = group,
  callback = function()
    vim.hl.on_yank()
  end,
  desc = "Highlight yanked text",
})

vim.api.nvim_create_autocmd({ "FocusGained", "TermClose", "TermLeave" }, {
  group = group,
  callback = function()
    if vim.bo.buftype ~= "nofile" then
      vim.cmd.checktime()
    end
  end,
  desc = "Check for external file changes",
})

vim.api.nvim_create_autocmd("BufWritePre", {
  group = group,
  callback = function(args)
    local name = vim.api.nvim_buf_get_name(args.buf)
    if name ~= "" and not name:match "^%w+://" then
      vim.fn.mkdir(vim.fn.fnamemodify(name, ":p:h"), "p")
    end
  end,
  desc = "Create missing parent directories",
})

vim.api.nvim_create_autocmd("BufReadPost", {
  group = group,
  callback = function(args)
    utils.is_large_buffer(args.buf)
    if vim.bo[args.buf].filetype == "gitcommit" then
      return
    end
    local mark = vim.api.nvim_buf_get_mark(args.buf, '"')
    if mark[1] > 0 and mark[1] <= vim.api.nvim_buf_line_count(args.buf) then
      pcall(vim.api.nvim_win_set_cursor, 0, mark)
    end
  end,
  desc = "Detect large files and restore cursor",
})

vim.api.nvim_create_autocmd("BufWinEnter", {
  group = group,
  callback = function(args)
    if
      vim.tbl_contains({ "help", "nofile", "quickfix" }, vim.bo[args.buf].buftype)
      and vim.fn.maparg("q", "n", false, true).buffer ~= 1
    then
      vim.keymap.set("n", "q", "<Cmd>close<CR>", { buffer = args.buf, silent = true, nowait = true })
    end
  end,
  desc = "Use q to close utility windows",
})

local function markdown_highlights()
  local light = { "#ffd6cc", "#e0f2fe", "#d5f5e3", "#fdebd0", "#e8daef", "#f2f3f4" }
  local dark = { "#8c3c2d", "#0b4d80", "#1c553b", "#7e6000", "#4a235a", "#566573" }
  for i = 1, 6 do
    vim.api.nvim_set_hl(0, "RenderMarkdownH" .. i, { bg = light[i], bold = true })
    vim.api.nvim_set_hl(0, "RenderMarkdownH" .. i .. "Bg", { bg = dark[i], bold = true })
    vim.api.nvim_set_hl(0, "@markup.heading." .. i .. ".markdown", { link = "RenderMarkdownH" .. i })
  end
end

vim.api.nvim_create_autocmd("ColorScheme", { group = group, callback = markdown_highlights })
markdown_highlights()
