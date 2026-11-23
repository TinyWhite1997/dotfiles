namespace SelectionTranslator
{
    public sealed class CliCopilotClient : ITranslationClient
    {
        readonly string nodePath, bridgePath, cliPath, sdkPath, model;

        public CliCopilotClient(string nodePath, string bridgePath, string cliPath, string sdkPath, string model)
        {
            this.nodePath = nodePath; this.bridgePath = bridgePath;
            this.cliPath = cliPath; this.sdkPath = sdkPath; this.model = model;
        }

        internal static async Task<string> ReadOutputAsync(StreamReader reader, Action<string> onDelta, CancellationToken cancellation)
        {
            var json = new JavaScriptSerializer();
            var result = new StringBuilder();
            string line;
            while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
            {
                cancellation.ThrowIfCancellationRequested();
                var item = json.Deserialize<Dictionary<string, object>>(line);
                string type = (string)item["type"];
                if (type == "delta")
                {
                    string delta = (string)item["text"];
                    result.Append(delta);
                    if (onDelta != null) onDelta(delta);
                }
                else if (type == "completed" && result.Length > 0) return result.ToString();
                else if (type == "error")
                    throw new InvalidOperationException("Copilot CLI 翻译失败。请检查登录、模型权限和网络；可用 -Probe 排查。");
            }
            throw new InvalidOperationException("Copilot CLI 提前结束，未收到完整译文。");
        }

        public async Task<string> TranslateAsync(string text, CancellationToken cancellation, Action<string> onDelta = null)
        {
            text = CopilotClient.ValidateText(text);
            cancellation.ThrowIfCancellationRequested();
            var info = new ProcessStartInfo(nodePath, "\"" + bridgePath + "\"") {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = Path.GetDirectoryName(bridgePath)
            };
            using (var process = new Process { StartInfo = info })
            using (var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
            {
                lifetime.CancelAfter(TimeSpan.FromSeconds(90));
                process.Start();
                var errors = process.StandardError.ReadToEndAsync();
                try
                {
                    using (var abort = lifetime.Token.Register(() => process.StandardOutput.BaseStream.Dispose()))
                    {
                        var payload = new JavaScriptSerializer().Serialize(new {
                            text = text, model = model, cliPath = cliPath, sdkPath = sdkPath
                        });
                        byte[] bytes = Encoding.UTF8.GetBytes(payload + "\n");
                        await process.StandardInput.BaseStream.WriteAsync(bytes, 0, bytes.Length, lifetime.Token).ConfigureAwait(false);
                        await process.StandardInput.BaseStream.FlushAsync(lifetime.Token).ConfigureAwait(false);
                        string result = await ReadOutputAsync(process.StandardOutput, onDelta, lifetime.Token).ConfigureAwait(false);
                        if (!await Task.Run(() => process.WaitForExit(5000)).ConfigureAwait(false))
                            throw new InvalidOperationException("Copilot CLI 未能正常结束翻译。");
                        await errors.ConfigureAwait(false);
                        if (process.ExitCode != 0) throw new InvalidOperationException("Copilot CLI 未能正常结束翻译。");
                        return result;
                    }
                }
                catch
                {
                    lifetime.Token.ThrowIfCancellationRequested();
                    throw;
                }
                finally
                {
                    process.StandardInput.Close();
                    // EOF asks the bridge to stop its SDK child before forced tree cleanup.
                    if (!process.WaitForExit(5000))
                        using (var kill = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + process.Id + " /T /F") {
                            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
                        })) { kill.WaitForExit(); }
                }
            }
        }

        public void TranslateToConsole(string text)
        {
            TranslateAsync(text, CancellationToken.None, Console.Write).GetAwaiter().GetResult();
            Console.WriteLine();
        }

        public void Dispose() { }
    }
}
