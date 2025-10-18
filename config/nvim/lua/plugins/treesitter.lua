---@type LazySpec
return {
  "nvim-treesitter/nvim-treesitter",
  opts = function(_, opts)
    -- `list_insert_unique` is in place, so it will modify
    -- the first parameter table if provided
    require("astrocore").list_insert_unique(opts.ensure_installed, { "html", "yaml", "typescript", "c_sharp" })
  end,
}
