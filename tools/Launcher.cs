using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

internal static class Launcher
{
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
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        bool quiet = Array.IndexOf(args, "--check") >= 0 || Array.IndexOf(args, "--help") >= 0 || Array.IndexOf(args, "-h") >= 0;
        bool gui = args.Length == 0 || Array.IndexOf(args, "--gui") >= 0 || Array.IndexOf(args, "--no-open") >= 0;
        int result = 1;
        try
        {
            string home = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UOOC-Study", "runtime");
            string hash;
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (SHA256 sha = SHA256.Create())
                hash = BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "").Substring(0, 16);
            string runtime = Path.Combine(cache, hash);
            if (!File.Exists(Path.Combine(runtime, ".ready")))
            {
                Console.WriteLine("Preparing UOOC Study runtime...");
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
                Arguments = arguments.ToString(), WorkingDirectory = home, UseShellExecute = false
            };
            start.EnvironmentVariables["UOOC_STUDY_HOME"] = home;
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
            using (Process child = Process.Start(start))
            {
                child.WaitForExit();
                result = child.ExitCode;
            }
        }
        catch (Exception error) { Console.Error.WriteLine("UOOC Study startup failed: " + error.Message); }
        if (!quiet && !gui && !Console.IsInputRedirected)
        {
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
        return result;
    }
}
