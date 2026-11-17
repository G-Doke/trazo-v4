<# : TRAZO v4 - instalador. Arriba lo lee cmd; desde el cierre del comentario, PowerShell.
@echo off
setlocal
title Instalar TRAZO v4
set "TRAZO_INSTALADOR=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText($env:TRAZO_INSTALADOR, [Text.Encoding]::UTF8))"
if errorlevel 1 (
  echo.
  echo   Apreta una tecla para cerrar esta ventana.
  pause >nul
  exit /b 1
)
echo.
echo   Esta ventana se cierra sola en unos segundos.
timeout /t 25 >nul
exit /b 0
#>

<#
  Instala TRAZO v4 en esta compu, sin que haga falta tener nada instalado antes:

    1. Copia TRAZO (lo que viene en trazo-v4.zip, al lado de este archivo) en
       %LOCALAPPDATA%\Programs\TRAZO v4.
    2. Baja Electron, el motor de la app, de la página oficial (GitHub), y
       revisa que sea idéntico al oficial antes de usarlo.
    3. Deja a la tablet conectarse por la red (el firewall de Windows pide
       permiso) y le pide a Windows la placa de video potente.
    4. Pone el acceso directo TRAZO v4 en el escritorio y en el menú Inicio, y
       lo abre.

  Si ya estaba instalado, lo actualiza sin tocar la escena guardada.
  Deja todo lo que pasó en %TEMP%\trazo-v4-instalacion.log.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$VERSION_ELECTRON = '44.4.1'
# El mismo que publica Electron en SHASUMS256.txt para ese zip.
$SHA_ELECTRON     = '34BC07977D6C43B6514B956A5F2E3292255DAA3838A49E6110F3FE19FFAFB83F'
$ZIP_ELECTRON     = "electron-v$VERSION_ELECTRON-win32-x64.zip"
$URL_ELECTRON     = "https://github.com/electron/electron/releases/download/v$VERSION_ELECTRON/$ZIP_ELECTRON"

$yo   = $env:TRAZO_INSTALADOR
$aqui = Split-Path -Parent $yo

# Para probar el instalador sin tocar la compu: con TRAZO_PRUEBA apuntando a
# una carpeta, todo va ahí adentro y no se toca ni el firewall ni el registro.
$prueba = $env:TRAZO_PRUEBA
if ($prueba){
  $destino    = Join-Path $prueba 'instalado'
  $escritorio = Join-Path $prueba 'escritorio'
  $menu       = Join-Path $prueba 'menu-inicio'
  $descargas  = Join-Path $prueba 'descargas'
  New-Item -ItemType Directory -Force -Path $escritorio, $menu | Out-Null
} else {
  $destino    = Join-Path $env:LOCALAPPDATA 'Programs\TRAZO v4'
  $escritorio = [Environment]::GetFolderPath('Desktop')
  $menu       = [Environment]::GetFolderPath('Programs')
  $descargas  = $null
  try { $descargas = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch { }
  if (-not $descargas){ $descargas = Join-Path $env:USERPROFILE 'Downloads' }
}
$exe = Join-Path $destino 'electron\electron.exe'
$tmp = Join-Path $env:TEMP ('trazo-v4-instalar-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

function Paso($txt){ Write-Host ''; Write-Host "  $txt" -ForegroundColor Cyan }
function Dato($txt){ Write-Host "     $txt" }
function Ojo($txt){ foreach ($l in ($txt -split "`n")){ Write-Host "     $l" -ForegroundColor Yellow } }
# Corta la instalación con un mensaje que se entienda, sin el detalle técnico.
function Cortar($txt){
  Write-Host ''
  foreach ($l in ($txt -split "`n")){ Write-Host "  $l" -ForegroundColor Yellow }
  $global:yaAvisado = $true
  throw 'cortado'
}
function Hash($a){ (Get-FileHash -LiteralPath $a -Algorithm SHA256).Hash }

function TieneTrazo($zip){
  try {
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try { return [bool]($z.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq 'trazo/index-v4.html' }) }
    finally { $z.Dispose() }
  } catch { return $false }
}

function BuscarPaquete(){
  $junto = Join-Path $aqui 'trazo-v4.zip'
  if ((Test-Path -LiteralPath $junto) -and (TieneTrazo $junto)){ return $junto }

  # Si se abrió el instalador sin descomprimir lo que bajó (de GitHub o de Drive), Windows
  # copió solo este archivo a una carpeta temporal y trazo-v4.zip quedó
  # adentro del zip de la descarga. Se lo busca ahí.
  if (-not $descargas -or -not (Test-Path -LiteralPath $descargas)){ return $null }
  $desde = (Get-Date).AddDays(-30)
  $zips = Get-ChildItem -LiteralPath $descargas -Filter *.zip -File -ErrorAction SilentlyContinue |
          Where-Object { $_.LastWriteTime -gt $desde } | Sort-Object LastWriteTime -Descending | Select-Object -First 20
  foreach ($c in $zips){
    if ($c.Name -like 'trazo-v4*.zip' -and (TieneTrazo $c.FullName)){ return $c.FullName }
    try {
      $z = [IO.Compression.ZipFile]::OpenRead($c.FullName)
      try {
        $e = $z.Entries | Where-Object { $_.Name -eq 'trazo-v4.zip' } | Select-Object -First 1
        if ($e){
          $sale = Join-Path $tmp 'trazo-v4.zip'
          [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $sale, $true)
          if (TieneTrazo $sale){ Dato "Lo saqué de $($c.Name), en Descargas."; return $sale }
        }
      } finally { $z.Dispose() }
    } catch { }
  }
  return $null
}

function Bajar($url, $a){
  $curl = Join-Path $env:WINDIR 'System32\curl.exe'
  if (Test-Path -LiteralPath $curl){
    # --ssl-no-revoke: algunas redes cortan la consulta de revocación del
    # certificado y la descarga falla sin motivo; el SHA256 de abajo igual
    # garantiza que el archivo es el oficial.
    & $curl -L --fail --retry 3 --retry-delay 3 --ssl-no-revoke --progress-bar -o $a $url
    if ($LASTEXITCODE -ne 0){ Cortar "No pude bajar Electron (error $LASTEXITCODE de curl).`nRevisá la conexión a internet y volvé a abrir el instalador." }
  } else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try { Invoke-WebRequest -Uri $url -OutFile $a -UseBasicParsing }
    catch { Cortar "No pude bajar Electron.`nRevisá la conexión a internet y volvé a abrir el instalador." }
  }
}

function HayReglaFirewall(){
  try {
    $f = Get-NetFirewallApplicationFilter -ErrorAction Stop | Where-Object { $_.Program -eq $exe }
    return [bool]($f | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' })
  } catch { return $false }
}

function CrearAcceso($lnk){
  $vbs = Join-Path $destino 'lanzador\lanzar-trazo.vbs'
  $ps1 = Join-Path $destino 'lanzador\lanzar-trazo.ps1'
  $sh  = New-Object -ComObject WScript.Shell
  $a   = $sh.CreateShortcut($lnk)
  $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
  if (Test-Path -LiteralPath $wscript){
    $a.TargetPath = $wscript
    $a.Arguments  = "`"$vbs`""
  } else {
    # Windows sin VBScript (Microsoft lo va a ir sacando): PowerShell directo,
    # con un parpadeo de ventana negra al abrir.
    $a.TargetPath  = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $a.Arguments   = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`""
    $a.WindowStyle = 7
  }
  $a.WorkingDirectory = Join-Path $destino 'lanzador'
  $a.IconLocation     = (Join-Path $destino 'lanzador\TRAZO-v4.ico') + ',0'
  $a.Description      = 'Abre TRAZO v4 y muestra la dirección para la tablet'
  $a.Save()
}

$codigo = 0
$global:yaAvisado = $false
$registro = Join-Path $env:TEMP 'trazo-v4-instalacion.log'
try { Start-Transcript -Path $registro -Force | Out-Null } catch { }

try {
  Write-Host ''
  Write-Host '  TRAZO v4 - instalación' -ForegroundColor White
  Write-Host '  ======================'
  Dato 'Se hace una sola vez. Al final queda el acceso directo TRAZO v4 en el escritorio.'
  if ($prueba){ Ojo "MODO PRUEBA: todo va a $prueba" }

  if (-not [Environment]::Is64BitOperatingSystem){
    Cortar 'TRAZO necesita Windows de 64 bits, y esta compu tiene uno de 32.'
  }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  # ---------------------------------------------------------------- 1
  Paso '1/5  Busco los archivos de TRAZO...'
  $paquete = BuscarPaquete
  if (-not $paquete){
    Cortar ("No encuentro trazo-v4.zip al lado de este instalador.`n`n" +
            "Primero descomprimí lo que bajaste: clic derecho en el .zip >`n" +
            "Extraer todo > Extraer. Después abrí INSTALAR TRAZO v4.bat desde la carpeta que queda.")
  }
  Dato 'Encontrados.'

  # ---------------------------------------------------------------- 2
  Paso '2/5  Copio TRAZO en esta compu...'
  $abiertos = Get-Process electron -ErrorAction SilentlyContinue |
              Where-Object { $_.Path -and $_.Path.StartsWith($destino, [StringComparison]::OrdinalIgnoreCase) }
  if ($abiertos){
    Cortar 'TRAZO está abierto. Cerrá la ventana del tablero (y la del cartel) y volvé a abrir el instalador.'
  }
  $sueltos = Join-Path $tmp 'paquete'
  [IO.Compression.ZipFile]::ExtractToDirectory($paquete, $sueltos)
  # Si ya estaba instalado, la escena que se fue dibujando acá no se pisa.
  if (Test-Path -LiteralPath (Join-Path $destino 'trazo\escena-compartida-8793.json')){
    Remove-Item -LiteralPath (Join-Path $sueltos 'trazo\escena-compartida-8793.json') -Force -ErrorAction SilentlyContinue
    Dato 'Ya estaba instalado: lo actualizo y la escena guardada queda como estaba.'
  }
  New-Item -ItemType Directory -Force -Path $destino | Out-Null
  & robocopy.exe $sueltos $destino /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8){ Cortar "No pude copiar los archivos en $destino." }
  Dato "Quedó en $destino"

  # ---------------------------------------------------------------- 3
  Paso '3/5  El motor de la app (Electron)...'
  $dirElectron = Join-Path $destino 'electron'
  $versionHay = ''
  $archivoVersion = Join-Path $dirElectron 'version'
  if (Test-Path -LiteralPath $archivoVersion){ $versionHay = (Get-Content -LiteralPath $archivoVersion -Raw).Trim() }
  if ((Test-Path -LiteralPath $exe) -and $versionHay -eq $VERSION_ELECTRON){
    Dato 'Ya estaba: no hace falta bajarlo de nuevo.'
  } else {
    # Si alguien dejó el zip de Electron al lado del instalador, se usa ese y no se baja nada.
    $zipE = Join-Path $aqui $ZIP_ELECTRON
    if (-not (Test-Path -LiteralPath $zipE) -or (Hash $zipE) -ne $SHA_ELECTRON){
      $zipE = Join-Path $tmp $ZIP_ELECTRON
      Dato 'Lo bajo de la página oficial (unos 150 MB). Según la conexión, tarda unos minutos:'
      Write-Host ''
      Bajar $URL_ELECTRON $zipE
      Write-Host ''
      if ((Hash $zipE) -ne $SHA_ELECTRON){
        Cortar "Electron bajó incompleto o distinto del oficial: no lo uso.`nRevisá la conexión y volvé a abrir el instalador."
      }
      Dato 'Bajado y revisado: es el oficial.'
    }
    Dato 'Lo descomprimo...'
    $nuevo = "$dirElectron.nuevo"
    if (Test-Path -LiteralPath $nuevo){ Remove-Item -LiteralPath $nuevo -Recurse -Force }
    [IO.Compression.ZipFile]::ExtractToDirectory($zipE, $nuevo)
    if (Test-Path -LiteralPath $dirElectron){ Remove-Item -LiteralPath $dirElectron -Recurse -Force }
    Rename-Item -LiteralPath $nuevo -NewName 'electron'
    if (-not (Test-Path -LiteralPath $exe)){ Cortar 'Electron no quedó bien descomprimido. Volvé a abrir el instalador.' }
    Dato 'Listo.'
  }

  # ---------------------------------------------------------------- 4
  Paso '4/5  Ajustes de Windows...'
  # Lo bajado de internet viene marcado, y Windows preguntaría cada vez si lo deja abrir.
  Get-ChildItem -LiteralPath $destino -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

  if ($prueba){
    Dato 'MODO PRUEBA: no toco la placa de video ni el firewall.'
  } else {
    # Placa de video potente: si la compu tiene dos (notebook), la salida
    # Spout tiene que ir por la misma que usa Resolume.
    $gpu = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
    if (-not (Test-Path $gpu)){ New-Item -Path $gpu -Force | Out-Null }
    Set-ItemProperty -Path $gpu -Name $exe -Value 'GpuPreference=2;'
    Dato 'Placa de video: la de alto rendimiento.'

    # Firewall: sin esta regla la tablet no llega al servidor de TRAZO.
    # Va también para las redes "públicas" porque Windows 11 marca así
    # cualquier wifi nueva, incluida la de casa.
    if (HayReglaFirewall){
      Dato 'Firewall: la tablet ya tenía permiso para conectarse.'
    } else {
      Ojo "Ahora Windows pregunta si deja hacer cambios: decí que Sí.`nEs el permiso para que la tablet se pueda conectar a TRAZO."
      $exeTxt = $exe -replace "'", "''"
      $orden  = "New-NetFirewallRule -DisplayName 'TRAZO v4 (tablet)' -Description 'Deja que la tablet se conecte a TRAZO v4 en la misma red.' " +
                "-Direction Inbound -Action Allow -Profile Any -Program '$exeTxt' | Out-Null"
      $cod    = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($orden))
      try {
        Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-EncodedCommand', $cod
      } catch { }
      if (HayReglaFirewall){
        Dato 'Firewall: listo, la tablet tiene permiso.'
      } else {
        Ojo ("No quedó el permiso del firewall. Cuando TRAZO se abra, Windows va a preguntar`n" +
             "si lo deja usar la red: marcá las dos casillas (redes privadas y públicas) y Permitir.")
      }
    }
  }

  # ---------------------------------------------------------------- 5
  Paso '5/5  Acceso directo...'
  CrearAcceso (Join-Path $escritorio 'TRAZO v4.lnk')
  CrearAcceso (Join-Path $menu 'TRAZO v4.lnk')
  Dato 'TRAZO v4 en el escritorio y en el menú Inicio.'

  Write-Host ''
  Write-Host '  Listo: TRAZO v4 quedó instalado.' -ForegroundColor Green
  Dato 'Para abrirlo, doble clic en TRAZO v4 del escritorio.'
  if (-not $prueba){
    Dato 'Ahora se abre solo: el tablero y un cartel con la dirección para la tablet.'
    Start-Process -FilePath (Join-Path $escritorio 'TRAZO v4.lnk')
  }
} catch {
  $codigo = 1
  if (-not $global:yaAvisado){
    Write-Host ''
    Write-Host "  Algo falló: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  Write-Host ''
  Write-Host "  El detalle quedó en $registro" -ForegroundColor DarkGray
} finally {
  if (Test-Path -LiteralPath $tmp){ Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  try { Stop-Transcript | Out-Null } catch { }
}
exit $codigo
