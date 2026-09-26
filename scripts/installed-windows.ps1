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
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
      $bitmap.Save($Value, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
  default { throw "Unknown installed acceptance action: $Action" }
}
