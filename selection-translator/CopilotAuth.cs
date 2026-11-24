namespace SelectionTranslator
{
    public sealed class NativeCopilotAuth
    {
        readonly string nodePath, scriptPath, runtimePath;

        public NativeCopilotAuth(string nodePath, string scriptPath, string runtimePath)
        {
            this.nodePath = nodePath; this.scriptPath = scriptPath; this.runtimePath = runtimePath;
        }

        public async Task<string> ReadTokenAsync(CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            var info = new ProcessStartInfo(nodePath, "\"" + scriptPath + "\" \"" + runtimePath + "\"") {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            using (var process = new Process { StartInfo = info })
            {
                process.Start();
                using (var abort = cancellation.Register(() => { if (!process.HasExited) process.Kill(); }))
                {
                    var output = process.StandardOutput.ReadToEndAsync();
                    var errors = process.StandardError.ReadToEndAsync();
                    await Task.Run(() => process.WaitForExit()).ConfigureAwait(false);
                    string token = (await output.ConfigureAwait(false)).Trim();
                    await errors.ConfigureAwait(false);
                    cancellation.ThrowIfCancellationRequested();
                    if (process.ExitCode != 0 || String.IsNullOrWhiteSpace(token))
                        throw new InvalidOperationException("无法读取 Copilot CLI 登录。请确认已登录，且 CLI 原生运行时与 Node.js 架构匹配。");
                    return token;
                }
            }
        }
    }
}
