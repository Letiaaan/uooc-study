param(
    [Parameter(Mandatory=$true)][ValidateSet('restore','notice')][string]$Action,
    [uint32]$BrowserProcessId = 0,
    [ValidateSet('login','credentials','quiz','video')][string]$Reason = 'login'
)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'restore') {
    if (-not $BrowserProcessId) { throw 'A browser process ID is required.' }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UoocBackgroundWindow {
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    public static int Restore(uint process) {
        int count = 0;
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == process && IsIconic(window)) {
                // SW_SHOWNOACTIVATE: restore rendering without taking foreground focus.
                if (ShowWindowAsync(window, 4)) count++;
            }
            return true;
        }, IntPtr.Zero);
        return count;
    }
}
'@
    [UoocBackgroundWindow]::Restore($BrowserProcessId)
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'UOOC Study'
$form.ClientSize = New-Object System.Drawing.Size(460, 210)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(24, 22)
$label.Size = New-Object System.Drawing.Size(412, 115)
$label.Text = switch ($Reason) {
    'credentials' { '请在 UOOC 官网完成登录。工作台没有提供完整的账号密码，需要你在官网补充。' }
    'quiz' { '测验需要人工验证或确认。点击“前往页面”处理，完成后程序会自动继续提交。' }
    'video' { '视频内题目需要本人处理。点击“前往页面”在当前视频中完成作答，程序会等待并自动继续播放。无需重新输入账号密码。' }
    default { '自动登录需要人工处理。账号密码已由程序填写，请前往 UOOC 页面完成验证或核对官网提示。' }
}
$label.Text += "`r`n`r`n如需安静运行，可在工作台关闭验证提醒。"
$open = New-Object System.Windows.Forms.Button
$open.Text = '前往页面'
$open.Location = New-Object System.Drawing.Point(226, 155)
$open.Size = New-Object System.Drawing.Size(100, 34)
$open.DialogResult = [System.Windows.Forms.DialogResult]::OK
$later = New-Object System.Windows.Forms.Button
$later.Text = '稍后处理'
$later.Location = New-Object System.Drawing.Point(336, 155)
$later.Size = New-Object System.Drawing.Size(100, 34)
$later.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.AddRange(@($label, $open, $later))
$form.CancelButton = $later
try {
    if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output 'open' }
} finally { $form.Dispose() }
