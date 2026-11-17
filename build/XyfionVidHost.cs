using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("XyfionVid")]
[assembly: AssemblyDescription("XyfionVid Ultra HD Video Downloader & Converter")]
[assembly: AssemblyProduct("XyfionVid Desktop App")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

namespace XyfionVidHost
{
    internal static class NativeMethods
    {
        [DllImport("user32.dll")]
        internal static extern bool SetProcessDPIAware();

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool SetDllDirectory(string lpPathName);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("user32.dll")]
        internal static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        internal static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CloseHandle(IntPtr hObject);

        internal static void EnableDarkTitleBar(IntPtr hwnd)
        {
            try
            {
                int useDark = 1;
                if (DwmSetWindowAttribute(hwnd, 20, ref useDark, sizeof(int)) != 0)
                {
                    DwmSetWindowAttribute(hwnd, 19, ref useDark, sizeof(int));
                }
            }
            catch
            {
            }
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public Int64 PerProcessUserTimeLimit;
        public Int64 PerJobUserTimeLimit;
        public UInt32 LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public UInt32 ActiveProcessLimit;
        public UIntPtr Affinity;
        public UInt32 PriorityClass;
        public UInt32 SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct IO_COUNTERS
    {
        public UInt64 ReadOperationCount;
        public UInt64 WriteOperationCount;
        public UInt64 OtherOperationCount;
        public UInt64 ReadTransferCount;
        public UInt64 WriteTransferCount;
        public UInt64 OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    internal sealed class JobObject : IDisposable
    {
        private IntPtr handle;

        public JobObject()
        {
            handle = NativeMethods.CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) return;

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION extendedInfo = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            extendedInfo.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr ptr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(extendedInfo, ptr, false);
                NativeMethods.SetInformationJobObject(handle, 9, ptr, (uint)size);
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
        }

        public void AddProcess(Process process)
        {
            if (handle != IntPtr.Zero && process != null && !process.HasExited)
            {
                try
                {
                    NativeMethods.AssignProcessToJobObject(handle, process.Handle);
                }
                catch
                {
                }
            }
        }

        public void Dispose()
        {
            if (handle != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(handle);
                handle = IntPtr.Zero;
            }
        }
    }

    internal sealed class SubStream : Stream
    {
        private readonly Stream baseStream;
        private readonly long offset;
        private readonly long length;
        private long position;

        public SubStream(Stream baseStream, long offset, long length)
        {
            this.baseStream = baseStream;
            this.offset = offset;
            this.length = length;
            this.position = 0;
        }

        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }

        public override long Position
        {
            get { return position; }
            set { Seek(value, SeekOrigin.Begin); }
        }

        public override int Read(byte[] buffer, int offsetInBuf, int count)
        {
            if (position >= length) return 0;
            long remaining = length - position;
            int toRead = (int)Math.Min(count, remaining);
            baseStream.Position = this.offset + position;
            int read = baseStream.Read(buffer, offsetInBuf, toRead);
            position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long next;
            if (origin == SeekOrigin.Begin) next = offset;
            else if (origin == SeekOrigin.Current) next = position + offset;
            else next = length + offset;

            if (next < 0) next = 0;
            if (next > length) next = length;
            position = next;
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }

    internal sealed class SplashForm : Form
    {
        private readonly ProgressBar progressBar;
        private readonly Label statusLabel;

        public SplashForm(Icon appIcon)
        {
            this.Text = "XyfionVid Başlatılıyor";
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(440, 190);
            this.BackColor = Color.FromArgb(13, 18, 32);
            this.TopMost = true;
            if (appIcon != null) this.Icon = appIcon;

            Label titleLabel = new Label();
            titleLabel.Text = "⚡ XyfionVid";
            titleLabel.Font = new Font("Segoe UI", 20f, FontStyle.Bold);
            titleLabel.ForeColor = Color.White;
            titleLabel.AutoSize = false;
            titleLabel.Size = new Size(400, 42);
            titleLabel.Location = new Point(24, 24);

            Label subLabel = new Label();
            subLabel.Text = "Ultra HD Video İndirici & Dönüştürücü";
            subLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            subLabel.ForeColor = Color.FromArgb(148, 163, 184);
            subLabel.AutoSize = false;
            subLabel.Size = new Size(400, 22);
            subLabel.Location = new Point(26, 68);

            statusLabel = new Label();
            statusLabel.Text = "Motorlar hazırlanıyor, lütfen bekleyin...";
            statusLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            statusLabel.ForeColor = Color.FromArgb(199, 210, 254);
            statusLabel.AutoSize = false;
            statusLabel.Size = new Size(392, 22);
            statusLabel.Location = new Point(26, 108);

            progressBar = new ProgressBar();
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;
            progressBar.Value = 5;
            progressBar.Size = new Size(392, 16);
            progressBar.Location = new Point(24, 138);

            this.Controls.Add(titleLabel);
            this.Controls.Add(subLabel);
            this.Controls.Add(statusLabel);
            this.Controls.Add(progressBar);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen pen = new Pen(Color.FromArgb(99, 102, 241), 2))
            {
                e.Graphics.DrawRectangle(pen, 1, 1, this.Width - 2, this.Height - 2);
            }
        }

        public void SetProgress(int percent, string text)
        {
            if (this.IsDisposed) return;
            if (this.InvokeRequired)
            {
                try
                {
                    this.BeginInvoke(new Action<int, string>(SetProgress), percent, text);
                }
                catch
                {
                }
                return;
            }

            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
            progressBar.Value = percent;
            if (!string.IsNullOrEmpty(text))
            {
                statusLabel.Text = text;
            }
        }
    }

    internal static class PayloadExtractor
    {
        private static readonly byte[] Magic = Encoding.ASCII.GetBytes("XYFIONPK");

        public static string EnsureAppDirectory(string exePath, Icon appIcon)
        {
            long payloadOffset;
            long payloadLength;

            if (!TryReadTrailer(exePath, out payloadOffset, out payloadLength))
            {
                // Dev / non-bundled fallback: check directory containing exe or parent directory
                string exeDir = Path.GetDirectoryName(exePath);
                if (File.Exists(Path.Combine(exeDir, "server.ts"))) return exeDir;
                string parentDir = Directory.GetParent(exeDir) != null ? Directory.GetParent(exeDir).FullName : exeDir;
                if (File.Exists(Path.Combine(parentDir, "server.ts"))) return parentDir;
                throw new InvalidOperationException("Uygulama paketi eksik veya bozuk.");
            }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string appDir = Path.Combine(localAppData, "XyfionVid", "app");
            Directory.CreateDirectory(appDir);

            using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (SubStream sub = new SubStream(fs, payloadOffset, payloadLength))
            using (ZipArchive zip = new ZipArchive(sub, ZipArchiveMode.Read))
            {
                string embeddedBuildId = ReadBuildId(zip);
                string localBuildIdPath = Path.Combine(appDir, "build_id.txt");
                string localBuildId = File.Exists(localBuildIdPath) ? File.ReadAllText(localBuildIdPath).Trim() : "";

                if (!string.IsNullOrEmpty(embeddedBuildId) && embeddedBuildId == localBuildId && CoreFilesExist(appDir))
                {
                    return appDir;
                }

                // Need first-time or version upgrade extraction
                SplashForm splash = new SplashForm(appIcon);
                Exception extractError = null;
                ManualResetEvent done = new ManualResetEvent(false);

                Thread worker = new Thread(delegate()
                {
                    try
                    {
                        ExtractArchive(zip, appDir, splash);
                    }
                    catch (Exception ex)
                    {
                        extractError = ex;
                    }
                    finally
                    {
                        done.Set();
                        if (!splash.IsDisposed)
                        {
                            try { splash.BeginInvoke(new Action(splash.Close)); } catch { }
                        }
                    }
                });
                worker.IsBackground = true;
                splash.Shown += delegate { worker.Start(); };
                Application.Run(splash);
                done.WaitOne();

                if (extractError != null)
                {
                    throw extractError;
                }
            }

            return appDir;
        }

        private static bool TryReadTrailer(string exePath, out long offset, out long length)
        {
            offset = 0;
            length = 0;
            FileInfo info = new FileInfo(exePath);
            if (info.Length < 24) return false;

            using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                fs.Seek(-24, SeekOrigin.End);
                byte[] buf = new byte[24];
                int read = fs.Read(buf, 0, 24);
                if (read != 24) return false;

                for (int i = 0; i < 8; i++)
                {
                    if (buf[16 + i] != Magic[i]) return false;
                }

                offset = BitConverter.ToInt64(buf, 0);
                length = BitConverter.ToInt64(buf, 8);
                if (offset <= 0 || length <= 0 || offset + length + 24 != info.Length) return false;
                return true;
            }
        }

        private static string ReadBuildId(ZipArchive zip)
        {
            ZipArchiveEntry entry = zip.GetEntry("build_id.txt");
            if (entry == null) return "";
            using (StreamReader sr = new StreamReader(entry.Open(), Encoding.UTF8))
            {
                return sr.ReadToEnd().Trim();
            }
        }

        private static bool CoreFilesExist(string appDir)
        {
            return File.Exists(Path.Combine(appDir, "server.ts")) &&
                   File.Exists(Path.Combine(appDir, "bin", "deno.exe")) &&
                   File.Exists(Path.Combine(appDir, "bin", "yt-dlp.exe")) &&
                   File.Exists(Path.Combine(appDir, "bin", "ffmpeg.exe")) &&
                   File.Exists(Path.Combine(appDir, "public", "index.html")) &&
                   File.Exists(Path.Combine(appDir, "webview2", "WebView2Loader.dll"));
        }

        private static void ExtractArchive(ZipArchive zip, string appDir, SplashForm splash)
        {
            // Kill any stale local deno processes belonging to appDir before overwriting binaries
            KillStaleAppDeno(appDir);

            ZipArchiveEntry buildIdEntry = null;
            int total = zip.Entries.Count;
            int index = 0;

            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                index++;
                int pct = total > 0 ? (int)((index * 100.0) / total) : 50;
                splash.SetProgress(pct, string.Format("Motorlar ve arayüz hazırlanıyor... %{0}", pct));

                string normalized = entry.FullName.Replace('/', '\\');
                if (string.IsNullOrEmpty(normalized) || normalized.EndsWith("\\"))
                {
                    string dirPath = Path.Combine(appDir, normalized);
                    Directory.CreateDirectory(dirPath);
                    continue;
                }

                if (string.Equals(normalized, "build_id.txt", StringComparison.OrdinalIgnoreCase))
                {
                    buildIdEntry = entry;
                    continue; // Write last as atomic commit marker
                }

                string destPath = Path.Combine(appDir, normalized);
                string parent = Path.GetDirectoryName(destPath);
                if (!string.IsNullOrEmpty(parent))
                {
                    Directory.CreateDirectory(parent);
                }

                using (Stream src = entry.Open())
                using (FileStream dst = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    src.CopyTo(dst);
                }
            }

            if (buildIdEntry != null)
            {
                string markerPath = Path.Combine(appDir, "build_id.txt");
                using (Stream src = buildIdEntry.Open())
                using (FileStream dst = new FileStream(markerPath, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    src.CopyTo(dst);
                }
            }

            splash.SetProgress(100, "Başlatılıyor...");
        }

        private static void KillStaleAppDeno(string appDir)
        {
            try
            {
                string targetDeno = Path.Combine(appDir, "bin", "deno.exe");
                Process[] procs = Process.GetProcessesByName("deno");
                foreach (Process p in procs)
                {
                    try
                    {
                        if (p.MainModule != null && string.Equals(p.MainModule.FileName, targetDeno, StringComparison.OrdinalIgnoreCase))
                        {
                            p.Kill();
                            p.WaitForExit(2000);
                        }
                    }
                    catch
                    {
                    }
                    finally
                    {
                        p.Dispose();
                    }
                }
            }
            catch
            {
            }
        }
    }

    internal sealed class BackendServer : IDisposable
    {
        private readonly string appDir;
        private readonly JobObject jobObject;
        private Process denoProcess;
        private StreamWriter logWriter;
        private readonly object logLock = new object();

        public int Port { get; private set; }
        public string BaseUrl { get { return "http://127.0.0.1:" + Port; } }

        public BackendServer(string appDir)
        {
            this.appDir = appDir;
            this.jobObject = new JobObject();
        }

        public void Start()
        {
            Port = PickPort(3000);

            string denoExe = ResolveDenoPath();
            string serverTs = Path.Combine(appDir, "server.ts");
            string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XyfionVid");
            Directory.CreateDirectory(logDir);
            string logPath = Path.Combine(logDir, "server.log");
            logWriter = new StreamWriter(logPath, false, Encoding.UTF8);

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = denoExe;
            psi.Arguments = string.Format("run --allow-net --allow-read --allow-write --allow-run --allow-env \"{0}\"", serverTs);
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["XYFIONVID_EXE_MODE"] = "1";
            psi.EnvironmentVariables["XYFIONVID_PORT"] = Port.ToString();

            denoProcess = new Process();
            denoProcess.StartInfo = psi;
            denoProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) WriteLog(e.Data);
            };
            denoProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) WriteLog("[ERR] " + e.Data);
            };

            denoProcess.Start();
            jobObject.AddProcess(denoProcess);
            denoProcess.BeginOutputReadLine();
            denoProcess.BeginErrorReadLine();

            WaitForReady(15000);
        }

        private string ResolveDenoPath()
        {
            string localDeno = Path.Combine(appDir, "bin", "deno.exe");
            if (File.Exists(localDeno)) return localDeno;
            return "deno.exe";
        }

        private int PickPort(int preferred)
        {
            if (IsPortAvailable(preferred)) return preferred;
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            try
            {
                listener.Start();
                return ((IPEndPoint)listener.LocalEndpoint).Port;
            }
            finally
            {
                listener.Stop();
            }
        }

        private static bool IsPortAvailable(int port)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (listener != null)
                {
                    try { listener.Stop(); } catch { }
                }
            }
        }

        private void WaitForReady(int timeoutMs)
        {
            Stopwatch sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (denoProcess.HasExited)
                {
                    throw new InvalidOperationException("Arka plan sunucusu beklenmedik şekilde kapandı. Detaylar için server.log dosyasını kontrol edin.");
                }

                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/status");
                    req.Timeout = 500;
                    req.Method = "GET";
                    using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                    {
                        if (res.StatusCode == HttpStatusCode.OK) return;
                    }
                }
                catch
                {
                }

                Thread.Sleep(60);
            }

            throw new TimeoutException("XyfionVid sunucusu zaman aşımına uğradı.");
        }

        public bool HasActiveJobs()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/active");
                req.Timeout = 400;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    string json = sr.ReadToEnd();
                    return json.Contains("\"starting\"") ||
                           json.Contains("\"downloading\"") ||
                           json.Contains("\"merging\"") ||
                           json.Contains("\"extracting\"") ||
                           json.Contains("\"converting\"");
                }
            }
            catch
            {
                return false;
            }
        }

        public void TriggerEndpoint(string path, string jsonBody)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BaseUrl + path);
                    req.Timeout = 1500;
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    byte[] bytes = Encoding.UTF8.GetBytes(jsonBody ?? "{}");
                    using (Stream reqStream = req.GetRequestStream())
                    {
                        reqStream.Write(bytes, 0, bytes.Length);
                    }
                    using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) { }
                }
                catch
                {
                }
            });
        }

        private void WriteLog(string line)
        {
            lock (logLock)
            {
                if (logWriter != null)
                {
                    try
                    {
                        logWriter.WriteLine(line);
                        logWriter.Flush();
                    }
                    catch
                    {
                    }
                }
            }
        }

        public void Shutdown()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/shutdown");
                req.Timeout = 600;
                req.Method = "POST";
                req.ContentLength = 0;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) { }
            }
            catch
            {
            }

            if (denoProcess != null && !denoProcess.HasExited)
            {
                try
                {
                    if (!denoProcess.WaitForExit(1200))
                    {
                        denoProcess.Kill();
                    }
                }
                catch
                {
                }
            }
        }

        public void Dispose()
        {
            Shutdown();
            jobObject.Dispose();
            if (denoProcess != null)
            {
                denoProcess.Dispose();
                denoProcess = null;
            }
            lock (logLock)
            {
                if (logWriter != null)
                {
                    try { logWriter.Dispose(); } catch { }
                    logWriter = null;
                }
            }
        }
    }

    internal static class UiRunner
    {
        public static void Run(BackendServer backend, EventWaitHandle wakeupEvent, Icon appIcon)
        {
            MainForm form = new MainForm(backend, wakeupEvent, appIcon);
            Application.Run(form);
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly BackendServer backend;
        private readonly EventWaitHandle wakeupEvent;
        private readonly NotifyIcon trayIcon;
        private WebView2 webView;
        private bool forceExit;
        private bool fallbackBrowserMode;

        public MainForm(BackendServer backend, EventWaitHandle wakeupEvent, Icon appIcon)
        {
            this.backend = backend;
            this.wakeupEvent = wakeupEvent;

            this.Text = "XyfionVid - Ultra HD Video Downloader & Converter";
            this.Size = new Size(1260, 840);
            this.MinimumSize = new Size(880, 620);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(9, 13, 22);
            if (appIcon != null) this.Icon = appIcon;

            ContextMenuStrip trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("⚡ XyfionVid Penceresini Göster", null, delegate { RestoreWindow(); });
            trayMenu.Items.Add("📁 İndirilenler Klasörünü Aç", null, delegate { backend.TriggerEndpoint("/api/open-folder", "{}"); });
            trayMenu.Items.Add("🧩 Tarayıcı Eklentisi Klasörü", null, delegate { backend.TriggerEndpoint("/api/open-extension", "{\"target\":\"folder\"}"); });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("❌ Tamamen Kapat", null, delegate { RequestExit(true); });

            trayIcon = new NotifyIcon();
            trayIcon.Icon = appIcon != null ? appIcon : SystemIcons.Application;
            trayIcon.Text = "XyfionVid - Ultra HD Video Downloader";
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += delegate { RestoreWindow(); };

            this.Load += OnFormLoad;
            this.FormClosing += OnFormClosing;

            StartWakeupListener();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeMethods.EnableDarkTitleBar(this.Handle);
        }

        private void OnFormLoad(object sender, EventArgs e)
        {
            InitializeWebView();
        }

        private void InitializeWebView()
        {
            try
            {
                webView = new WebView2();
                webView.Dock = DockStyle.Fill;
                webView.DefaultBackgroundColor = Color.FromArgb(9, 13, 22);
                webView.CoreWebView2InitializationCompleted += OnCoreWebView2Ready;
                this.Controls.Add(webView);

                string userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "XyfionVid",
                    "webview2_data"
                );
                Directory.CreateDirectory(userDataFolder);

                CoreWebView2Environment.CreateAsync(null, userDataFolder).ContinueWith(delegate(System.Threading.Tasks.Task<CoreWebView2Environment> t)
                {
                    if (this.IsDisposed) return;
                    if (t.IsFaulted || t.IsCanceled)
                    {
                        this.BeginInvoke(new Action<Exception>(SwitchToBrowserFallback), t.Exception);
                        return;
                    }

                    CoreWebView2Environment env = t.Result;
                    this.BeginInvoke(new Action(delegate
                    {
                        try
                        {
                            webView.EnsureCoreWebView2Async(env);
                        }
                        catch (Exception ex)
                        {
                            SwitchToBrowserFallback(ex);
                        }
                    }));
                });
            }
            catch (Exception ex)
            {
                SwitchToBrowserFallback(ex);
            }
        }

        private void OnCoreWebView2Ready(object sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess || webView == null || webView.CoreWebView2 == null)
            {
                SwitchToBrowserFallback(e.InitializationException);
                return;
            }

            CoreWebView2 core = webView.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsBuiltInErrorPageEnabled = true;

            core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs args)
            {
                if (args.PermissionKind == CoreWebView2PermissionKind.ClipboardRead ||
                    args.PermissionKind == CoreWebView2PermissionKind.MultipleAutomaticDownloads)
                {
                    args.State = CoreWebView2PermissionState.Allow;
                }
            };

            core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs args)
            {
                args.Handled = true;
                try
                {
                    if (!string.IsNullOrEmpty(args.Uri))
                    {
                        Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
                    }
                }
                catch
                {
                }
            };

            core.Navigate(backend.BaseUrl);
        }

        private void SwitchToBrowserFallback(Exception ex)
        {
            if (fallbackBrowserMode) return;
            fallbackBrowserMode = true;

            try
            {
                if (webView != null)
                {
                    this.Controls.Remove(webView);
                    webView.Dispose();
                    webView = null;
                }
            }
            catch
            {
            }

            LaunchFallbackAppBrowser(backend.BaseUrl);
            this.Hide();
            this.ShowInTaskbar = false;
            trayIcon.ShowBalloonTip(4000, "XyfionVid Arka Planda Çalışıyor", "Uygulama tarayıcınızda açıldı. Kapatmak için sağ alt tepsideki simgeye sağ tıklayın.", ToolTipIcon.Info);
        }

        private static void LaunchFallbackAppBrowser(string url)
        {
            string[] edgePaths = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe")
            };

            foreach (string p in edgePaths)
            {
                if (File.Exists(p))
                {
                    Process.Start(p, "--app=" + url);
                    return;
                }
            }

            string[] chromePaths = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
            };

            foreach (string p in chromePaths)
            {
                if (File.Exists(p))
                {
                    Process.Start(p, "--app=" + url);
                    return;
                }
            }

            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }

        public void RestoreWindow()
        {
            if (this.IsDisposed) return;
            if (this.InvokeRequired)
            {
                try { this.BeginInvoke(new Action(RestoreWindow)); } catch { }
                return;
            }

            if (fallbackBrowserMode)
            {
                LaunchFallbackAppBrowser(backend.BaseUrl);
                return;
            }

            this.Show();
            this.ShowInTaskbar = true;
            if (this.WindowState == FormWindowState.Minimized)
            {
                this.WindowState = FormWindowState.Normal;
            }
            NativeMethods.ShowWindow(this.Handle, 9); // SW_RESTORE
            this.Activate();
            NativeMethods.SetForegroundWindow(this.Handle);
        }

        private void StartWakeupListener()
        {
            Thread t = new Thread(delegate()
            {
                while (!this.IsDisposed)
                {
                    try
                    {
                        if (wakeupEvent.WaitOne(500))
                        {
                            RestoreWindow();
                        }
                    }
                    catch
                    {
                        break;
                    }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        private void RequestExit(bool skipConfirm)
        {
            if (skipConfirm)
            {
                forceExit = true;
            }
            this.Close();
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (!forceExit && e.CloseReason == CloseReason.UserClosing && backend.HasActiveJobs())
            {
                DialogResult choice = MessageBox.Show(
                    "Devam eden bir indirme veya dönüştürme işlemi var!\n\n" +
                    "• EVET: Uygulamayı arka planda (sistem tepsisinde) küçült ve indirmeye devam et.\n" +
                    "• HAYIR: İşlemi durdur ve uygulamayı tamamen kapat.\n" +
                    "• İPTAL: Pencereye geri dön.",
                    "XyfionVid - Devam Eden İşlem",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Question
                );

                if (choice == DialogResult.Cancel)
                {
                    e.Cancel = true;
                    return;
                }
                if (choice == DialogResult.Yes)
                {
                    e.Cancel = true;
                    this.Hide();
                    this.ShowInTaskbar = false;
                    trayIcon.ShowBalloonTip(3000, "XyfionVid Arka Planda", "İndirme devam ediyor. Açmak için simgeye çift tıklayın.", ToolTipIcon.Info);
                    return;
                }
            }

            trayIcon.Visible = false;
            trayIcon.Dispose();
            backend.Shutdown();
        }
    }

    internal static class Program
    {
        [STAThread]
        public static void Main()
        {
            NativeMethods.SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Local\\XyfionVid_SingleInstance_Mutex", out createdNew))
            using (EventWaitHandle wakeupEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\XyfionVid_Wakeup_Event"))
            {
                if (!createdNew)
                {
                    wakeupEvent.Set();
                    return;
                }

                string exePath = Assembly.GetExecutingAssembly().Location;
                Icon appIcon = null;
                try { appIcon = Icon.ExtractAssociatedIcon(exePath); } catch { }

                string appDir;
                try
                {
                    appDir = PayloadExtractor.EnsureAppDirectory(exePath, appIcon);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "XyfionVid başlatılırken bir hata oluştu:\n\n" + ex.Message,
                        "XyfionVid Başlatma Hatası",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                string webViewDir = Path.Combine(appDir, "webview2");
                if (Directory.Exists(webViewDir))
                {
                    NativeMethods.SetDllDirectory(webViewDir);
                }

                AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs args)
                {
                    string asmName = new AssemblyName(args.Name).Name + ".dll";
                    string candidate = Path.Combine(webViewDir, asmName);
                    if (File.Exists(candidate))
                    {
                        return Assembly.LoadFrom(candidate);
                    }
                    return null;
                };

                using (BackendServer backend = new BackendServer(appDir))
                {
                    try
                    {
                        backend.Start();
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show(
                            "XyfionVid motoru başlatılamadı:\n\n" + ex.Message,
                            "XyfionVid Motor Hatası",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        return;
                    }

                    UiRunner.Run(backend, wakeupEvent, appIcon);
                }
            }
        }
    }
}
