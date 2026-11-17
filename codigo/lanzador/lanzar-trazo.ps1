<#
  TRAZO v4 — lanzador del acceso directo del escritorio, para una compu que
  no es la MSI (lo deja instalado INSTALAR TRAZO v4.bat).

  Abre la app de escritorio (tablero + salida Spout para Resolume), espera a
  que el servidor esté vivo y muestra un cartel con la dirección para la
  tablet y su QR. La dirección cambia según la red: por eso se calcula cada
  vez y no se escribe a mano.

  Es el lanzador de la MSI con dos cambios para andar en cualquier compu:
  el QR lo arma el mismo electron.exe haciendo de Node (no hace falta tener
  Node instalado), y el cartel sale en una ventanita propia (cartel\), así
  no depende de que haya Chrome.
#>
$ErrorActionPreference = 'Stop'
$aqui     = Split-Path -Parent $MyInvocation.MyCommand.Path
$base     = Split-Path -Parent $aqui
$electron = Join-Path $base 'electron\electron.exe'
$puerto   = 8793
$nombre   = 'TRAZO v4'
# La app lee esto al arrancar: puerto y tablero de la v4.
$env:TRAZO_PUERTO  = '8793'
$env:TRAZO_ARCHIVO = 'index-v4.html'

# Deja rastro de cada paso, para cuando algo no arranca: el archivo trazo-lanzador.log en %TEMP%
$log = Join-Path $env:TEMP 'trazo-lanzador.log'
function Paso($txt){
  try { Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $txt) -Encoding UTF8 } catch { }
}
Set-Content -Path $log -Value '' -Encoding UTF8 -ErrorAction SilentlyContinue
Paso "arranca el lanzador ($nombre, puerto $puerto)"

function Avisar($texto, $titulo, $icono){
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  [System.Windows.Forms.MessageBox]::Show($texto, $titulo, 'OK', $icono) | Out-Null
}

# Un doble clic doble no tiene que abrir dos carteles.
$traba = New-Object System.Threading.Mutex($false, 'Local\TRAZO-v4-lanzador')
if (-not $traba.WaitOne(0)){ Paso 'ya hay un lanzador andando'; exit 0 }

if (-not (Test-Path $electron)){
  Avisar "Falta una parte de TRAZO en esta compu.`n`nVolvé a abrir INSTALAR TRAZO v4.bat (el que vino en la carpeta de Drive)." $nombre 'Warning'
  exit 1
}

# A mano y no con Invoke-WebRequest: así no pasa por el proxy del sistema ni
# prueba primero por IPv6 (::1), que es lo que lo hacía tardar una eternidad.
function ServidorVivo(){
  try {
    $req = [System.Net.WebRequest]::Create("http://127.0.0.1:$puerto/estado")
    $req.Proxy = $null
    $req.Timeout = 1500
    $resp = $req.GetResponse()
    $txt = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    $resp.Close()
    return ($txt -match 'TRAZO3_SERVIDOR')
  } catch {
    $script:ultimoError = $_.Exception.Message
    return $false
  }
}

# La app tiene traba de instancia única: si ya está abierta, abrirla de nuevo
# solo la trae al frente, y el cartel vuelve a salir con la dirección.
Paso 'abro la app'
Start-Process -FilePath $electron -ArgumentList "`"$base\trazo\escritorio`"" -WorkingDirectory (Join-Path $base 'trazo')

Paso 'app lanzada; espero al servidor'
$vivo = $false
$ultimoError = ''
foreach ($i in 1..45){
  if (ServidorVivo){ $vivo = $true; break }
  if ($i -eq 1 -or $i -eq 20){ Paso "el servidor todavía no contesta (intento $i): $ultimoError" }
  Start-Sleep -Milliseconds 700
}

if (-not $vivo){
  Paso "me cansé de esperar al servidor: $ultimoError"
  Avisar "La app abrió pero el servidor no levantó en el puerto $puerto.`n`nCerrá la ventana de TRAZO si quedó abierta y volvé a abrir este acceso directo. Si sigue igual, reiniciá la compu." $nombre 'Warning'
  exit 1
}

Paso 'servidor vivo'
# --- direcciones para la tablet (la de la wifi primero) ---
$ips = @()
foreach ($ip in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue){
  if ($ip.IPAddress -like '127.*' -or $ip.IPAddress -like '169.254.*'){ continue }
  if ($ip.InterfaceAlias -match 'Loopback|vEthernet|VirtualBox|VMware|Hyper-V'){ continue }
  $peso = 1
  if ($ip.InterfaceAlias -match 'Wi-?Fi|Wireless|Inalámbrica'){ $peso = 0 }
  $ips += [pscustomobject]@{ Dir = "http://$($ip.IPAddress):$puerto"; Red = $ip.InterfaceAlias; Peso = $peso }
}
# El @() es a propósito: con una sola red, Sort-Object devuelve un objeto suelto
# sin .Count y el cartel terminaba diciendo "sin red".
$ips = @($ips | Sort-Object Peso, Red)
$principal = $null
if ($ips.Count -gt 0){ $principal = $ips[0].Dir }
$estable = "http://$($env:COMPUTERNAME.ToLower()).local:$puerto"

Paso 'direcciones listas'
# --- estado de la salida Spout (lo dice el título de la ventana) ---
Start-Sleep -Seconds 2
$titulo = ''
$proc = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'TRAZO v3*' } | Select-Object -First 1
if ($proc){ $titulo = $proc.MainWindowTitle }
$spoutOk = $titulo -match 'Spout "TRAZO v3"'

Paso 'titulo leido'
# --- avisos ---
$avisos = @()
if (-not $spoutOk){
  $avisos += @{ tipo = 'ojo'; txt = 'La salida Spout no arrancó: si usás Resolume, ahí no va a aparecer la fuente. El tablero y la tablet andan igual.' }
}
$bat = Get-CimInstance -ClassName BatteryStatus -Namespace root\wmi -ErrorAction SilentlyContinue | Select-Object -First 1
if ($bat -and -not $bat.PowerOnline){
  $avisos += @{ tipo = 'ojo'; txt = 'Estás en batería: la salida baja de 60 a unos 30 cuadros por segundo. Enchufá el cargador.' }
}
if (-not $principal){
  $avisos += @{ tipo = 'mal'; txt = 'Esta compu no está en ninguna red: conectá la wifi y volvé a abrir el acceso directo.' }
}

Paso 'avisos listos'
# --- QR de la dirección principal: electron.exe hace de Node ---
# Con Process y no con &: electron.exe es una app de ventana, y PowerShell no
# espera ni junta lo que escribe una app de ventana si no se lo fuerza.
$qr = ''
if ($principal){
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $electron
    $psi.Arguments = "`"$(Join-Path $aqui 'qr.js')`" `"$principal`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $p = [System.Diagnostics.Process]::Start($psi)
    $salida = $p.StandardOutput.ReadToEndAsync()
    if ($p.WaitForExit(10000)){ $qr = $salida.Result } else { try { $p.Kill() } catch { } }
  } catch { $qr = '' }
  if ($qr -notlike 'data:image/*'){ $qr = ''; Paso 'no salió el QR' }
}

Paso 'copio al portapapeles'
if ($principal){ try { Set-Clipboard -Value $principal -ErrorAction SilentlyContinue } catch { } }

Paso 'QR listo'
# --- cartel ---
$filasAvisos = ''
foreach ($a in $avisos){
  $filasAvisos += "<p class=""aviso $($a.tipo)"">$($a.txt)</p>"
}
$otras = ''
foreach ($i in $ips){
  if ($i.Dir -ne $principal){ $otras += "<li><code>$($i.Dir)</code> <span>$($i.Red)</span></li>" }
}
$otras += "<li><code>$estable</code> <span>en iPad y iPhone suele andar siempre, aunque cambie la red</span></li>"

$bloqueQr = ''
if ($qr){ $bloqueQr = "<img class=""qr"" src=""$qr"" alt=""QR"">" }
$linkPrincipal = 'sin red'
if ($principal){ $linkPrincipal = $principal }

$html = @"
<!doctype html><html lang="es"><head><meta charset="utf-8"><title>$nombre</title><style>
*{box-sizing:border-box} body{margin:0;background:#0b0d10;color:#e8eef2;
  font:15px/1.5 "Segoe UI",system-ui,sans-serif;padding:26px 30px}
h1{margin:0 0 2px;font-size:19px;letter-spacing:.04em}
h1 b{color:#22d3ee} .sub{margin:0 0 20px;color:#7e8b95;font-size:13px}
.caja{display:flex;gap:26px;align-items:center;background:#11151a;border:1px solid #1e262e;
  border-radius:14px;padding:20px 22px}
.link{font-size:31px;font-weight:600;color:#22d3ee;letter-spacing:.01em;word-break:break-all;user-select:all}
.info{min-width:0;flex:1}
.pie{margin-top:7px;color:#7e8b95;font-size:12.5px}
.qr{width:168px;height:168px;border-radius:10px;background:#fff;padding:7px;flex:none}
.aviso{margin:14px 0 0;padding:11px 14px;border-radius:10px;font-size:13.5px}
.aviso.ojo{background:#2b210c;border:1px solid #6b5316;color:#f6c453}
.aviso.mal{background:#2b1010;border:1px solid #6b1c1c;color:#ff8a8a}
h2{margin:26px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#7e8b95}
ol{margin:0;padding-left:19px;color:#c7d2da;font-size:13.5px} ol li{margin:4px 0}
ul{margin:0;padding-left:19px;list-style:none} ul li{margin:4px 0;font-size:13px;color:#8d99a3}
code{color:#c7d2da;font-family:Consolas,monospace;user-select:all}
ul li span{color:#5f6b75;font-size:12px;margin-left:6px}
.estado{margin-top:22px;font-size:12.5px;color:#6f7b85;border-top:1px solid #1e262e;padding-top:12px}
</style></head><body>
<h1><b>$nombre</b> está andando</h1>
<p class="sub">El tablero ya está abierto en su ventana.</p>
<div class="caja">
  <div class="info">
    <div style="color:#7e8b95;font-size:12px;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px">Dirección para la tablet</div>
    <div class="link">$linkPrincipal</div>
    <div class="pie">Escaneá el QR con la cámara de la tablet o escribí la dirección en Safari o Chrome. La tablet tiene que estar en la misma wifi que esta compu. Ya quedó copiada en el portapapeles.</div>
  </div>
  $bloqueQr
</div>
$filasAvisos
<h2>Si usás Resolume</h2>
<ol>
  <li>Sources &gt; Spout Servers &gt; <b>TRAZO v3</b>: arrastralo a un clip y disparalo.</li>
  <li>La capa en modo <b>Alpha</b>, con Alpha Type en <b>Premultiplied</b>.</li>
</ol>
<h2>Otras direcciones</h2>
<ul>$otras</ul>
<p class="estado">$titulo<br>Cerrar la ventana del tablero cierra todo y guarda la escena. Este cartel se cierra con la X; para volver a verlo, abrí de nuevo el acceso directo TRAZO v4.</p>
</body></html>
"@

Paso 'cartel armado'
# El nombre lo conoce cartel\main.js: lo vuelve a leer si el cartel ya estaba abierto.
$cartel = Join-Path $env:TEMP 'trazo-v4-cartel.html'
[IO.File]::WriteAllText($cartel, $html, (New-Object System.Text.UTF8Encoding($false)))

function CartelAbierto(){
  $v = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'TRAZO v4*' }
  return ($v -ne $null)
}

Paso 'abro el cartel'
Start-Process -FilePath $electron -ArgumentList "`"$aqui\cartel`""
$abierto = $false
foreach ($e in 1..12){
  Start-Sleep -Milliseconds 500
  if (CartelAbierto){ $abierto = $true; break }
}
if (-not $abierto){
  Paso 'el cartel no apareció: lo abro en el navegador de siempre'
  Start-Process $cartel
}

Paso 'listo'
