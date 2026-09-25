$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '../src-tauri/src/windows.ps1'
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('depthplan-acl-' + [guid]::NewGuid())
$previousMode = $env:DEPTHPLAN_ACL_MODE
$previousPath = $env:DEPTHPLAN_ACL_PATH

function Test-PrivatePath($mode, $target, $expectedSuccess) {
  $env:DEPTHPLAN_ACL_MODE = $mode
  $env:DEPTHPLAN_ACL_PATH = $target
  # Windows PowerShell turns redirected native stderr into ErrorRecords. Keep
  # the child's exit code authoritative, including expected verification failures.
  $ErrorActionPreference = 'Continue'
  $output = & $powershell -NoLogo -NoProfile -NonInteractive -File $helper 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if (($code -eq 0) -ne $expectedSuccess) {
    throw "ACL $mode returned $code for $target`n$($output -join "`n")"
  }
}

try {
  New-Item -ItemType Directory -Path $root | Out-Null
  $directory = New-Item -ItemType Directory -Path (Join-Path $root 'directory')
  $file = New-Item -ItemType File -Path (Join-Path $root 'file.json')
  foreach ($target in @($directory.FullName, $file.FullName)) {
    Test-PrivatePath 'verify' $target $false
    Test-PrivatePath 'secure' $target $true
    Test-PrivatePath 'verify' $target $true

    $acl = Get-Acl -LiteralPath $target
    $everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $target -AclObject $acl
    Test-PrivatePath 'verify' $target $false
    Test-PrivatePath 'secure' $target $true
    Test-PrivatePath 'verify' $target $true
  }
  Write-Output 'PASS Windows private paths: files/directories, protected current-user ACLs, foreign access rejection and repair.'
} finally {
  $env:DEPTHPLAN_ACL_MODE = $previousMode
  $env:DEPTHPLAN_ACL_PATH = $previousPath
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
