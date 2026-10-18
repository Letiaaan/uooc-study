using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Launcher
{
    [DllImport("kernel32.dll")] private static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll")] private static extern bool AllocConsole();
    [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll")] private static extern uint GetFileType(IntPtr handle);
    private static readonly object logLock = new object();

    private static void Record(StreamWriter log, string line, bool error)
    {
        if (line == null) return;
        lock (logLock)
        {
            if (log != null) log.WriteLine(line);
            else if (error) Console.Error.WriteLine(line);
            else Console.WriteLine(line);
        }
    }

    private static string Quote(string value)
    {
        StringBuilder text = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            text.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            text.Append(character);
            slashes = 0;
        }
        text.Append('\\', slashes * 2);
        return text.Append('"').ToString();
    }

    private static int Main(string[] args)
    {
        bool quiet = Array.IndexOf(args, "--check") >= 0 || Array.IndexOf(args, "--help") >= 0 || Array.IndexOf(args, "-h") >= 0;
        bool gui = Array.IndexOf(args, "--gui") >= 0 || !(Array.IndexOf(args, "--cli") >= 0 || Array.IndexOf(args, "--inspect") >= 0 || Array.IndexOf(args, "--logout") >= 0 || Array.Exists(args, a => a == "--mode" || a.StartsWith("--mode=") || a == "--courses" || a.StartsWith("--courses=")));
        bool hidden = gui && !quiet && Array.IndexOf(args, "--no-open") < 0;
        uint inheritedOutputType = GetFileType(GetStdHandle(-11));
        bool capture = hidden || quiet || Array.IndexOf(args, "--no-open") >= 0 || inheritedOutputType == 1 || inheritedOutputType == 3;
        if (!hidden)
        {
            uint outputType = GetFileType(GetStdHandle(-11));
            if (outputType == 1 || outputType == 3)
            {
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
                Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
            }
            else
            {
                if (!AttachConsole(uint.MaxValue)) AllocConsole();
                Console.OutputEncoding = new UTF8Encoding(false);
                Console.InputEncoding = new UTF8Encoding(false);
            }
        }
        int result = 1;
        StreamWriter log = null;
        try
        {
            string home = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (hidden)
            {
                string logDirectory = Path.Combine(home, "data");
                Directory.CreateDirectory(logDirectory);
                log = new StreamWriter(Path.Combine(logDirectory, "startup.log"), false, new UTF8Encoding(false));
                log.AutoFlush = true;
            }
            string cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UOOC-Study", "runtime");
            string hash;
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (SHA256 sha = SHA256.Create())
                hash = BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "").Substring(0, 16);
            string runtime = Path.Combine(cache, hash);
            if (!File.Exists(Path.Combine(runtime, ".ready")))
            {
                if (!hidden) Console.WriteLine("Preparing UOOC Study runtime...");
                Directory.CreateDirectory(runtime);
                using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string target = Path.GetFullPath(Path.Combine(runtime, entry.FullName));
                        if (!target.StartsWith(runtime + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("Invalid runtime entry.");
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                    }
                }
                File.WriteAllText(Path.Combine(runtime, ".ready"), hash);
            }
            StringBuilder arguments = new StringBuilder(Quote(Path.Combine(runtime, "app.js")));
            foreach (string argument in args) arguments.Append(' ').Append(Quote(argument));
            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = Path.Combine(runtime, "runtime", "node.exe"),
                Arguments = arguments.ToString(), WorkingDirectory = home, UseShellExecute = false,
                CreateNoWindow = capture, RedirectStandardOutput = capture, RedirectStandardError = capture
            };
            if (capture) { start.StandardOutputEncoding = Encoding.UTF8; start.StandardErrorEncoding = Encoding.UTF8; }
            start.EnvironmentVariables["UOOC_STUDY_HOME"] = home;
            if (!hidden) Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
            using (Process child = Process.Start(start))
            {
                if (capture)
                {
                    child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Record(log, e.Data, false); };
                    child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Record(log, e.Data, true); };
                    child.BeginOutputReadLine();
                    child.BeginErrorReadLine();
                }
                child.WaitForExit();
                result = child.ExitCode;
            }
            if (hidden && result != 0) MessageBox.Show("启动或运行异常，请查看工作台运行记录及 data\\startup.log。", "UOOC Study", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        catch (Exception error)
        {
            if (hidden) MessageBox.Show("UOOC Study 启动失败：" + error.Message, "UOOC Study", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else Console.Error.WriteLine("UOOC Study startup failed: " + error.Message);
        }
        finally { if (log != null) log.Dispose(); }
        if (!quiet && !gui && !Console.IsInputRedirected)
        {
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
        return result;
    }
}
