$ErrorActionPreference = 'Stop'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('depthplan-acl-' + [guid]::NewGuid())
$probe = Join-Path $root 'private-path-probe.exe'

function Test-PrivatePath($mode, $target, $expectedSuccess) {
  # Windows PowerShell turns redirected native stderr into ErrorRecords. Keep
  # the child's exit code authoritative, including expected verification failures.
  $ErrorActionPreference = 'Continue'
  $output = & $probe $mode $target 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if (($code -eq 0) -ne $expectedSuccess) {
    throw "ACL $mode returned $code for $target`n$($output -join "`n")"
  }
}

try {
  New-Item -ItemType Directory -Path $root | Out-Null
  $source = Join-Path $PSScriptRoot 'windows-private-probe.rs'
  & rustfmt --check $source
  if ($LASTEXITCODE -ne 0) { throw 'Windows permission probe formatting failed' }
  & rustc --edition=2021 $source -o $probe
  if ($LASTEXITCODE -ne 0) { throw 'Windows permission probe compilation failed' }
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
  & $probe serve ('depthplan-probe-' + [guid]::NewGuid())
  if ($LASTEXITCODE -ne 0) { throw 'Windows pipe startup failed' }
  Write-Output 'PASS Windows pipe helper startup.'
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
