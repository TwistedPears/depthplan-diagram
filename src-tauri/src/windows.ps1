$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($env:DEPTHPLAN_ACL_MODE -ne 'serve') {
  $p = $env:DEPTHPLAN_ACL_PATH
  $acl = Get-Acl -LiteralPath $p
  if ($env:DEPTHPLAN_ACL_MODE -eq 'secure') {
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
    $acl.SetOwner($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $p -AclObject $acl
    $acl = Get-Acl -LiteralPath $p
  }
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $sid -or !$acl.AreAccessRulesProtected) { throw 'Unsafe owner' }
  foreach ($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference -ne $sid) { throw 'Unsafe ACL' }
  }
  exit 0
}
# Preserve the current-user-only pipe DACL through the platform's PipeSecurity
# API. This helper uses Windows PowerShell, never an installed Node runtime.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Collections.Concurrent;
using System.Threading;
public class DepthPlanPipe {
  static readonly ConcurrentDictionary<string, NamedPipeServerStream> Clients = new ConcurrentDictionary<string, NamedPipeServerStream>();
  static readonly object Output = new object();
  public static void Run(string name) {
    var sid = WindowsIdentity.GetCurrent().User;
    var security = new PipeSecurity();
    security.SetAccessRuleProtection(true, false);
    security.SetOwner(sid);
    security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid,null), PipeAccessRights.FullControl, AccessControlType.Deny));
    security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
    var replies = new Thread(() => {
      string line;
      while ((line = Console.ReadLine()) != null) {
        var parts = line.Split('\t'); NamedPipeServerStream client;
        if (parts.Length == 2 && Clients.TryGetValue(parts[0], out client)) {
          try { var bytes = Convert.FromBase64String(parts[1]); client.Write(bytes,0,bytes.Length); } catch {} finally { NamedPipeServerStream done; Clients.TryRemove(parts[0],out done); client.Dispose(); }
        }
      }
      Environment.Exit(0);
    });
    replies.IsBackground = true; replies.Start();
    bool ready = false;
    var slots = new SemaphoreSlim(32);
    while (true) {
      slots.Wait();
      var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 32, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 1048576, security);
      if (!ready) { Console.WriteLine("READY"); ready = true; }
      pipe.WaitForConnection();
      var current = pipe;
      ThreadPool.QueueUserWorkItem(_ => {
        var id = Guid.NewGuid().ToString("N");
        using (var timeout = new Timer(__ => { NamedPipeServerStream stale; if (Clients.TryRemove(id,out stale)) stale.Dispose(); else current.Dispose(); }, null, 5000, Timeout.Infinite)) {
          try {
            using (var bytes = new MemoryStream()) {
              int b;
              while ((b=current.ReadByte()) != -1 && b != 10) { if (bytes.Length >= 65536) return; bytes.WriteByte((byte)b); }
              if (b != 10) return;
              Clients[id] = current;
              lock (Output) { Console.WriteLine(id + "\t" + Convert.ToBase64String(bytes.ToArray())); }
              while (Clients.ContainsKey(id)) Thread.Sleep(10);
            }
          } catch {} finally { NamedPipeServerStream stale; Clients.TryRemove(id,out stale); current.Dispose(); slots.Release(); }
        }
      });
    }
  }
}
'@
[DepthPlanPipe]::Run($env:DEPTHPLAN_ACL_PATH)
