return {
  {
    "lewis6991/gitsigns.nvim",
    event = { "BufReadPre", "BufNewFile" },
    opts = {
      signs = {
        add = { text = "▎" },
        change = { text = "▎" },
        delete = { text = "▎" },
        topdelete = { text = "▎" },
        changedelete = { text = "▎" },
        untracked = { text = "▎" },
      },
      signs_staged = {
        add = { text = "▎" },
        change = { text = "▎" },
        delete = { text = "▎" },
        topdelete = { text = "▎" },
        changedelete = { text = "▎" },
        untracked = { text = "▎" },
      },
      on_attach = function(bufnr)
        local gs = require "gitsigns"
        local function map(mode, lhs, rhs, desc)
          vim.keymap.set(mode, lhs, rhs, { buffer = bufnr, desc = desc })
        end
        map("n", "<Leader>gl", gs.blame_line, "View Git blame")
        map("n", "<Leader>gL", function()
          gs.blame_line { full = true }
        end, "View full Git blame")
        map("n", "<Leader>gp", gs.preview_hunk_inline, "Preview Git hunk")
        map("n", "<Leader>gr", gs.reset_hunk, "Reset Git hunk")
        map("x", "<Leader>gr", function()
          gs.reset_hunk { vim.fn.line ".", vim.fn.line "v" }
        end, "Reset Git hunk")
        map("n", "<Leader>gR", gs.reset_buffer, "Reset Git buffer")
        map("n", "<Leader>gs", gs.stage_hunk, "Stage/unstage Git hunk")
        map("x", "<Leader>gs", function()
          gs.stage_hunk { vim.fn.line ".", vim.fn.line "v" }
        end, "Stage Git hunk")
        map("n", "<Leader>gS", gs.stage_buffer, "Stage Git buffer")
        map("n", "<Leader>gd", gs.diffthis, "View Git diff")
        map("n", "[G", function()
          gs.nav_hunk "first"
        end, "First Git hunk")
        map("n", "]G", function()
          gs.nav_hunk "last"
        end, "Last Git hunk")
        map("n", "]g", function()
          gs.nav_hunk "next"
        end, "Next Git hunk")
        map("n", "[g", function()
          gs.nav_hunk "prev"
        end, "Previous Git hunk")
        map({ "o", "x" }, "ig", ":<C-U>Gitsigns select_hunk<CR>", "Inside Git hunk")
      end,
    },
  },
}
