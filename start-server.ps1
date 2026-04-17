$ErrorActionPreference = "Stop"

$port = 8000
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Test-PythonCommand([string]$command) {
  try {
    $output = & $command --version 2>&1
    if ($output -match "Python was not found") {
      return $false
    }
    return $true
  } catch {
    return $false
  }
}

if (Get-Command python -ErrorAction SilentlyContinue) {
  if (Test-PythonCommand "python") {
    python -m http.server $port
    exit 0
  }
}

if (Get-Command py -ErrorAction SilentlyContinue) {
  if (Test-PythonCommand "py") {
    py -m http.server $port
    exit 0
  }
}

function Get-MimeType([string]$path) {
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  switch ($ext) {
    ".html" { "text/html" }
    ".css" { "text/css" }
    ".js" { "application/javascript" }
    ".json" { "application/json" }
    ".svg" { "image/svg+xml" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".gif" { "image/gif" }
    ".ico" { "image/x-icon" }
    ".gpx" { "application/gpx+xml" }
    default { "application/octet-stream" }
  }
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Serving $root at $prefix (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $relativePath = $request.Url.AbsolutePath.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
      $relativePath = "index.html"
    }

    $fullPath = Join-Path $root $relativePath
    if (Test-Path $fullPath -PathType Container) {
      $fullPath = Join-Path $fullPath "index.html"
    }

    if (-not (Test-Path $fullPath -PathType Leaf)) {
      $response.StatusCode = 404
      $message = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
      $response.OutputStream.Write($message, 0, $message.Length)
      $response.OutputStream.Close()
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $response.ContentType = Get-MimeType $fullPath
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
