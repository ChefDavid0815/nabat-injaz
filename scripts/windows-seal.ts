import { execFileSync } from 'node:child_process';
import path from 'node:path';
/** Local release evidence credentials/backups are bound to this Windows account. */
export function seal(bytes: Buffer) {
  const script =
    "$raw=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; $plain=[Convert]::FromBase64String($raw); $sealed=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); $check=[Security.Cryptography.ProtectedData]::Unprotect($sealed,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); if([Convert]::ToBase64String($check) -ne $raw){throw 'DPAPI round-trip failed'}; [Console]::Out.Write([Convert]::ToBase64String($sealed))";
  return Buffer.from(
    execFileSync(
      path.join(
        process.env.SystemRoot || 'C:/Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { input: bytes.toString('base64'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ).trim(),
    'base64',
  );
}
