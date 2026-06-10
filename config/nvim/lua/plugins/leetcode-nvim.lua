---@type LazySpec
return {
  "kawre/leetcode.nvim",
  cmd = "Leet",
  build = ":TSUpdate html",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "MunifTanjim/nui.nvim",
    "folke/snacks.nvim",
    "nvim-treesitter/nvim-treesitter",
  },
  keys = {
    {
      "<leader>L",
      "<cmd>Leet<cr>",
      desc = "LeetCode actions",
    },
  },
  ---@type lc.UserConfig
  opts = {
    picker = { provider = "snacks-picker" },
    plugins = {
      non_standalone = true,
    },
  },
}
