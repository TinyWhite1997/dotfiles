const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { registerHooks } = require("node:module");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { test } = require("node:test");

const configPath = resolve(__dirname, "../neovim.lua");
const nvim = process.platform === "win32" ? "nvim.exe" : "nvim";

// Exercise the real Ctrl+G handler, but never open a terminal or a Herdr pane.
test("Ctrl+G shares its lightweight arguments and preserves prompt round trips", async (t) => {
  const write = process.stdout.write;
  t.mock.method(process.stdout, "write", function (data, ...args) {
    return data === "\x1b[2J\x1b[H" ? true : write.call(this, data, ...args);
  });
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source;
      if (specifier === "@earendil-works/pi-coding-agent") {
        source = "export class CustomEditor { handleInput() {} }";
      } else if (specifier === "@earendil-works/pi-tui") {
        source = "export const matchesKey = (data, key) => data === '\\x07' && key === 'ctrl+g';";
      } else if (specifier === "./herdr-pi-popup/popup.ts") {
        source = `export const inHerdr = ${context.parentURL.includes("popup")}; export const runInHerdrPopup = (_, opts) => globalThis.piNvimLaunch(opts.command, opts.args, opts);`;
      } else if (specifier === "node:child_process" && context.parentURL.includes("neovim.ts")) {
        source = "export const spawnSync = (...args) => globalThis.piNvimLaunch(...args);";
      }
      return source
        ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
        : next(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis.piNvimLaunch; });

  for (const route of ["terminal", "popup"]) {
    for (const status of [0, 1]) {
      await t.test(`${route}, exit ${status}`, { timeout: 5000 }, async () => {
        let session, editor, promptPath, launches = 0, text = "# 原始提示\n\n保留空行";
        const terminal = [];
        const frames = [];
        const tui = {
          stop: () => terminal.push("stop"),
          start: () => terminal.push("start"),
          requestRender: () => frames.push(text),
        };
        const notifications = [];
        let finish;
        const finished = new Promise((resolve) => { finish = resolve; });
        globalThis.piNvimLaunch = (command, args, opts) => {
          launches++;
          assert.equal(command, nvim);
          assert.deepEqual(args.slice(0, 2), ["-u", configPath]);
          assert.equal(args.length, 3);
          assert.equal(opts.cwd, process.platform === "win32" ? process.cwd() : tmpdir());
          promptPath = args[2];
          assert.equal(readFileSync(promptPath, "utf8"), text);
          writeFileSync(promptPath, "\uFEFF# 修改后\r\n\r\n提示词 ✓\r\n");
          return { status };
        };
        const initialize = (await import(`../neovim.ts?${route}-${status}`)).default;
        initialize({ on: (event, handler) => { assert.equal(event, "session_start"); session = handler; } });
        const ctx = {
          mode: "tui", cwd: tmpdir(),
          ui: {
            setEditorComponent: (factory) => { editor = factory(tui, {}, {}); },
            getEditorText: () => text,
            setEditorText: (value) => { text = value; finish(); },
            notify: (...args) => { notifications.push(args); finish(); },
            custom: (factory) => new Promise((done) => {
              const savedText = text;
              factory(tui, {}, {}, (result) => {
                // Match Pi: restore and render the old editor before resolving.
                text = savedText;
                tui.requestRender();
                done(result);
              });
            }),
          },
        };
        session({}, { ...ctx, mode: "print" });
        assert.equal(editor, undefined, "non-TUI mode must not install the editor");
        session({}, ctx);
        editor.handleInput("x");
        assert.equal(launches, 0);
        editor.handleInput("\x07");
        editor.handleInput("\x07"); // Ignore a second launch while editing.
        await finished;
        await new Promise(setImmediate); // Let the launch finish, without another keypress.
        assert.equal(launches, 1);
        assert.equal(text, status === 0 ? "# 修改后\r\n\r\n提示词 ✓" : "# 原始提示\n\n保留空行");
        assert.equal(notifications.length, status === 0 ? 0 : 1);
        assert.equal(existsSync(dirname(promptPath)), false, "temporary prompt directory leaked");
        assert.deepEqual(terminal, route === "terminal" ? ["stop", "start"] : []);
        if (status === 0) assert.equal(frames.at(-1), text, "saved prompt must render without another keypress");
      });
    }
  }
});

test("real Neovim: isolated prompt profile, editing, save, and missing-plugin fallback", { timeout: 30000 }, (t) => {
  if (spawnSync(nvim, ["--version"]).error?.code === "ENOENT") return t.skip("Neovim is not installed");
  const directory = mkdtempSync(join(tmpdir(), "pi nvim test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const probe = join(directory, "probe.lua");
  writeFileSync(probe, `
vim.api.nvim_create_autocmd('VimEnter', { once = true, callback = function()
  vim.schedule(function()
    local ok, err = xpcall(function()
      assert(vim.g.pi_prompt and not vim.o.loadplugins)
      assert(vim.bo.filetype == 'markdown')
      assert(vim.bo.syntax == 'markdown' or vim.treesitter.highlighter.active[vim.api.nvim_get_current_buf()], 'Markdown highlighter')
      assert(vim.o.clipboard == 'unnamedplus' and vim.o.showmode)
      for _, mode in ipairs({'n', 'x'}) do
        for key, rhs in pairs({H = '0', J = '5j', K = '5k', L = '$'}) do
          assert(vim.fn.maparg(key, mode) == rhs, mode .. ': missing editing map ' .. key)
        end
      end
      assert(vim.g.mapleader == ' ')
      assert(vim.fn.maparg('<Leader>w', 'n') == '<Cmd>w<CR>')
      assert(vim.fn.maparg('<Leader>q', 'n') == '<Cmd>confirm q<CR>')
      for _, key in ipairs({'<Leader>bb', '<Leader>pi', '<Leader>pm', '<Leader><Leader>mo'}) do
        assert(vim.fn.maparg(key, 'n') == '', key .. ' should not reference an unloaded plugin')
      end
      for name, module in pairs({catppuccin = 'catppuccin', ['nvim-surround'] = 'nvim-surround', ['nvim-autopairs'] = 'nvim-autopairs'}) do
        local installed = vim.uv.fs_stat(vim.fn.stdpath('data') .. '/lazy/' .. name) ~= nil
        assert((package.loaded[module] ~= nil) == installed, name .. ' was not loaded as expected')
      end
      local function keys(value)
        vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(value, true, false, true), 'xt', false)
      end
      vim.api.nvim_buf_set_lines(0, 0, -1, false, vim.fn['repeat']({'abcdef'}, 11))
      for _, mode in ipairs({'n', 'x'}) do
        for key, position in pairs({H = {6, 0}, J = {11, 2}, K = {1, 2}, L = {6, mode == 'x' and 6 or 5}}) do
          vim.api.nvim_win_set_cursor(0, {6, 2})
          keys((mode == 'x' and 'v' or '') .. key)
          assert(vim.deep_equal(vim.api.nvim_win_get_cursor(0), position), mode .. ': movement ' .. key)
          keys('<Esc>')
        end
      end
      if package.loaded['nvim-autopairs'] then
        vim.api.nvim_buf_set_lines(0, 0, -1, false, {''})
        keys('i(<Esc>')
        assert(vim.api.nvim_get_current_line() == '()', 'autopairs')
      end
      if package.loaded['nvim-surround'] then
        vim.api.nvim_buf_set_lines(0, 0, -1, false, {'hello'})
        vim.api.nvim_win_set_cursor(0, {1, 0})
        keys('ysiw)')
        assert(vim.api.nvim_get_current_line() == '(hello)', 'surround')
      end
      assert(not package.loaded['better_escape'])
      for _, escape in ipairs({'jk', 'jj'}) do
        assert(vim.fn.maparg(escape, 'i') == '<Esc>')
        vim.api.nvim_buf_set_lines(0, 0, -1, false, {''})
        keys('ihello' .. escape .. 'A!<Esc>')
        assert(vim.api.nvim_get_current_line() == 'hello!', escape .. ' should exit insert mode')
      end
      vim.api.nvim_buf_set_lines(0, 0, -1, false, {'# 中文提示', '', '保留  两个空格 ✓'})
      keys(' w')
      assert(not vim.bo.modified, '<Leader>w should save')
      for name in pairs(package.loaded) do
        for _, prefix in ipairs({'lazy', 'mason', 'lspconfig', 'schemastore', 'snacks', 'render-markdown', 'nvim-treesitter'}) do
          assert(name:sub(1, #prefix) ~= prefix, 'unexpected plugin: ' .. name)
        end
      end
      assert(#vim.lsp.get_clients() == 0)
      assert(vim.v.errmsg == '', vim.v.errmsg)
      if vim.env.PI_TEST_EMPTY_DATA == '1' then
        assert(vim.g.colors_name == 'habamax')
        assert(not package.loaded['nvim-autopairs'] and not package.loaded['nvim-surround'])
      end
      -- The shared keymap module still registers plugin commands in normal Neovim.
      vim.g.pi_prompt = nil
      package.loaded['config.keymaps'] = nil
      require('config.keymaps')
      for _, key in ipairs({'<Leader>bb', '<Leader>pi', '<Leader>pm', '<Leader><Leader>mo'}) do
        assert(vim.fn.maparg(key, 'n') ~= '', key .. ' missing from normal Neovim')
      end
    end, debug.traceback)
    if not ok then
      vim.api.nvim_err_writeln(err)
      vim.cmd('cquit 1')
    else
      vim.api.nvim_feedkeys(' q', 'xt', false)
      vim.cmd('cquit 1') -- A working <Leader>q exits before reaching this line.
    end
  end)
end })
`);
  for (const emptyData of [false, true]) {
    const prompt = join(directory, `prompt ${emptyData}.md`);
    writeFileSync(prompt, "# Test\n");
    const result = spawnSync(nvim, [
      "--headless", "-i", "NONE", "-n",
      "-u", configPath, prompt, "-c", "lua dofile(vim.env.PI_TEST_NVIM_PROBE)",
    ], {
      encoding: "utf8", timeout: 12000, cwd: directory,
      env: { ...process.env, XDG_CONFIG_HOME: join(directory, "empty-config"), PI_TEST_NVIM_PROBE: probe,
        PI_TEST_EMPTY_DATA: emptyData ? "1" : "0", XDG_CACHE_HOME: join(directory, "cache"),
        ...(emptyData ? { XDG_DATA_HOME: join(directory, "empty-data") } : {}),
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(prompt, "utf8").replace(/\r\n/g, "\n"), "# 中文提示\n\n保留  两个空格 ✓\n");
  }
});
