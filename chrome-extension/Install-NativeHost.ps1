param(
    [switch]$BuildOnly,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$hostName = "com.aethelguard.file_guard"
$installDirectory = Join-Path $env:LOCALAPPDATA "Aethelguard\NativeHost"
$executablePath = Join-Path $installDirectory "AethelguardNativeHost.exe"
$manifestPath = Join-Path $installDirectory "com.aethelguard.file_guard.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$sourcePath = Join-Path $PSScriptRoot "native-host\NativeHost.cs"

if ($Uninstall) {
    if (Test-Path $registryPath) {
        Remove-Item -LiteralPath $registryPath -Force
    }
    foreach ($path in @($executablePath, $manifestPath)) {
        if (Test-Path $path) {
            Remove-Item -LiteralPath $path -Force
        }
    }
    Write-Output "Aethelguard's Chrome native host was unregistered."
    exit 0
}

if (-not (Test-Path $sourcePath)) {
    throw "Native host source was not found: $sourcePath"
}

if ($BuildOnly) {
    $temporaryExecutable = Join-Path $env:TEMP ("AethelguardNativeHost-" + [guid]::NewGuid().ToString("N") + ".exe")
    try {
        Add-Type -Path $sourcePath `
            -OutputAssembly $temporaryExecutable `
            -OutputType ConsoleApplication `
            -ReferencedAssemblies "System.Web.Extensions.dll"
        Write-Output "Native host compiled successfully."
    }
    finally {
        if (Test-Path $temporaryExecutable) {
            Remove-Item -LiteralPath $temporaryExecutable -Force
        }
    }
    exit 0
}

$extensionId = (Read-Host "Enter the Aethelguard extension ID from chrome://extensions").Trim().ToLowerInvariant()
if ($extensionId -notmatch "^[a-p]{32}$") {
    throw "That does not look like a Chrome extension ID (expected 32 letters from a to p)."
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Add-Type -Path $sourcePath `
    -OutputAssembly $executablePath `
    -OutputType ConsoleApplication `
    -ReferencedAssemblies "System.Web.Extensions.dll"

$manifest = @{
    name = $hostName
    description = "Aethelguard completed-download hashing and quarantine"
    path = $executablePath
    type = "stdio"
    allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
    $manifestPath,
    $manifest,
    (New-Object System.Text.UTF8Encoding($false))
)

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath
Write-Output "Aethelguard's native host is installed. Reload the extension in chrome://extensions."
