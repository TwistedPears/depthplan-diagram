param([string]$Action, [string]$Value, [string]$Extra)
$ErrorActionPreference = 'Stop'
switch ($Action) {
  'install' {
    $result = Start-Process -FilePath $Value -ArgumentList "/S /D=$Extra" -Wait -PassThru
    if ($result.ExitCode -ne 0) { throw "Installer exit $($result.ExitCode)" }
  }
  'open' { Start-Process -FilePath $Value }
  'processes' {
    $items = @(Get-Process depthplan -ErrorAction SilentlyContinue | ForEach-Object { @{ pid = $_.Id; path = $_.Path } })
    ConvertTo-Json -InputObject $items -Compress
  }
  'close' { $p = Get-Process -Id ([int]$Value); if (-not $p.CloseMainWindow()) { throw 'Window did not accept close' } }
  'association' {
    $class = (Get-Item "Registry::HKEY_CURRENT_USER\Software\Classes\.$Value").GetValue('')
    @{ class = $class; command = (Get-Item "Registry::HKEY_CURRENT_USER\Software\Classes\$class\shell\open\command").GetValue(''); icon = (Get-Item "Registry::HKEY_CURRENT_USER\Software\Classes\$class\DefaultIcon").GetValue('') } | ConvertTo-Json -Compress
  }
  'capture' {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InstalledWindow {
  public struct Rect { public int Left, Top, Right, Bottom; }
  public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
    [void][InstalledWindow]::SetProcessDPIAware()
    $window = (Get-Process depthplan).MainWindowHandle
    $client = New-Object InstalledWindow+Rect
    $origin = New-Object InstalledWindow+Point
    if (-not [InstalledWindow]::GetClientRect($window, [ref]$client) -or -not [InstalledWindow]::ClientToScreen($window, [ref]$origin)) { throw 'Could not inspect the installed window' }
    $workArea = [System.Windows.Forms.Screen]::FromHandle($window).WorkingArea
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
      $bitmap.Save($Value, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    if ($origin.X -lt $workArea.Left -or $origin.Y -lt $workArea.Top -or ($origin.X + $client.Right) -gt $workArea.Right -or ($origin.Y + $client.Bottom) -gt $workArea.Bottom) {
      throw "Installed content extends beyond the work area: origin=($($origin.X),$($origin.Y)), size=($($client.Right),$($client.Bottom)), workArea=$workArea"
    }
  }
  default { throw "Unknown installed acceptance action: $Action" }
}
