/**
 * TRAZO v3 — app de escritorio.
 *
 * Abre el tablero en una ventana propia y, al mismo tiempo, una ventana de
 * salida invisible (fuera de pantalla) que se dibuja en la placa de video y
 * sale directo por Spout. En Resolume aparece como fuente "TRAZO v3", con
 * fondo transparente: no hace falta OBS.
 *
 * El servidor de TRAZO v3 (el mismo de iniciar.bat) se levanta solo si no
 * estaba andando, así la tablet se conecta igual que siempre.
 */
'use strict';

const { app, BrowserWindow, Menu, session, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { fork } = require('child_process');

/* TRAZO_PUERTO solo sirve para probar la app sin tocar un servidor abierto */
const PUERTO = Number(process.env.TRAZO_PUERTO) || 8791;
/* TRAZO_ARCHIVO elige qué tablero levanta la app: index.html (el de siempre)
   o index-b.html (la versión B). El Spout no cambia: sale lo mismo. */
const ARCHIVO = (process.env.TRAZO_ARCHIVO || 'index.html').replace(/[^A-Za-z0-9_.-]/g, '') || 'index.html';
const SALA = 'vivo';
const RAIZ = path.join(__dirname, '..');                 // la carpeta de TRAZO v3
const NOMBRE_SPOUT = 'TRAZO v3';

/* Chromium: que la salida no se frene nunca, aunque nada la muestre, y que
   dibuje en la placa de video potente (en una notebook con dos placas,
   Resolume suele correr en la potente: Spout necesita que sea la misma). */
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* ---------------- configuración (se recuerda entre sesiones) ---------------- */
const CONFIG_POR_DEFECTO = { spout: true, ancho: 1920, alto: 1080, fps: 60, alfa: true, modo: 'gpu' };
let config = { ...CONFIG_POR_DEFECTO };
const archivoConfig = () => path.join(app.getPath('userData'), 'config.json');
function leerConfig(){
  try { config = { ...CONFIG_POR_DEFECTO, ...JSON.parse(fs.readFileSync(archivoConfig(), 'utf8')) }; }
  catch (err) { /* primera vez: valores de fábrica */ }
}
function guardarConfig(){
  try { fs.writeFileSync(archivoConfig(), JSON.stringify(config, null, 2)); }
  catch (err) { /* sin disco: sigue igual */ }
}

/* ---------------- Spout ---------------- */
let spoutMod = null, spoutError = '';
try {
  /* el módulo compilado viaja al lado de este archivo; build/ es donde lo deja node-gyp */
  const listo = path.join(__dirname, 'spout', 'salida_spout.node');
  spoutMod = require(fs.existsSync(listo) ? listo : './spout/build/Release/salida_spout.node');
} catch (err) {
  spoutError = err.message;
}

/* ---------------- servidor ---------------- */
let servidor = null;              // el proceso, si lo levantamos nosotros

function preguntarEstado(){
  return new Promise(ok => {
    const req = http.get({ host: '127.0.0.1', port: PUERTO, path: '/estado', timeout: 800 }, res => {
      let txt = '';
      res.on('data', d => { txt += d; });
      res.on('end', () => ok(txt.includes('TRAZO3_SERVIDOR')));
    });
    req.on('error', () => ok(false));
    req.on('timeout', () => { req.destroy(); ok(false); });
  });
}

async function asegurarServidor(){
  if (await preguntarEstado()) return true;
  servidor = fork(path.join(RAIZ, 'servidor-local.js'), ['--puerto=' + PUERTO, '--archivo=' + ARCHIVO], {
    cwd: RAIZ,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const log = fs.createWriteStream(path.join(app.getPath('userData'), 'servidor.log'), { flags: 'w' });
  servidor.stdout.pipe(log);
  servidor.stderr.pipe(log);
  for (let i = 0; i < 40; i++){
    await new Promise(ok => setTimeout(ok, 150));
    if (await preguntarEstado()) return true;
  }
  return false;
}

function direccionesTablet(){
  const dirs = [];
  for (const lista of Object.values(os.networkInterfaces())){
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) dirs.push('http://' + i.address + ':' + PUERTO);
  }
  dirs.push('http://' + os.hostname().toLowerCase() + '.local:' + PUERTO);
  return dirs;
}

/* ---------------- ventanas ---------------- */
let tablero = null, salida = null, spout = null;
let enviados = 0, fallas = 0, ultimoAviso = '';

function urlTablero(){ return 'http://localhost:' + PUERTO + '/?sala=' + SALA; }
function urlSalida(){ return urlTablero() + '&salida=1' + (config.alfa ? '&alfa=1' : ''); }

function crearTablero(){
  tablero = new BrowserWindow({
    width: 1600, height: 950, minWidth: 900, minHeight: 600,
    title: 'TRAZO v3', backgroundColor: '#000000', autoHideMenuBar: false,
    webPreferences: { backgroundThrottling: false }
  });
  tablero.loadURL(urlTablero());
  tablero.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } }
  }));
  tablero.on('page-title-updated', e => e.preventDefault());
  tablero.on('closed', () => { tablero = null; app.quit(); });
}

function abrirSpout(){
  if (spout || !spoutMod) return !!spout;
  try {
    spout = new spoutMod.SalidaSpout(NOMBRE_SPOUT, 'alto');
    return true;
  } catch (err) {
    spoutError = err.message;
    spout = null;
    return false;
  }
}

function cerrarSalida(){
  if (salida && !salida.isDestroyed()) salida.destroy();
  salida = null;
  if (spout){ try { spout.cerrar(); } catch (err) { /* ya estaba cerrado */ } spout = null; }
}

function crearSalida(){
  cerrarSalida();
  if (!config.spout) return;
  if (!abrirSpout()){
    avisar('No pude abrir Spout: ' + spoutError);
    return;
  }
  const porGpu = config.modo === 'gpu';
  fallas = 0;
  salida = new BrowserWindow({
    show: false, width: config.ancho, height: config.alto, useContentSize: true,
    frame: false, transparent: true, backgroundColor: '#00000000', enableLargerThanScreen: true,
    webPreferences: {
      offscreen: porGpu ? { useSharedTexture: true } : true,
      backgroundThrottling: false
    }
  });
  salida.webContents.setFrameRate(config.fps);
  salida.webContents.on('paint', (event, dirty, image) => {
    if (!spout) { if (event.texture) event.texture.release(); return; }
    let ok = false;
    if (porGpu){
      const tex = event.texture;
      if (!tex) return;
      try {
        ok = spout.enviarTextura(tex.textureInfo.handle.ntHandle);
      } catch (err) {
        ok = false;
      } finally {
        tex.release();
      }
      if (!ok && ++fallas > 45){
        /* la textura no se puede compartir en esta máquina: modo compatible */
        config.modo = 'cpu';
        guardarConfig();
        avisar('La placa de video no dejó compartir la textura: pasé al modo compatible.');
        setImmediate(() => { crearSalida(); armarMenu(); });
        return;
      }
    } else {
      const t = image.getSize();
      ok = spout.enviarCuadro(image.toBitmap(), t.width, t.height);
    }
    if (ok){ enviados++; fallas = 0; }
  });
  salida.webContents.on('render-process-gone', () => setTimeout(crearSalida, 1000));
  salida.loadURL(urlSalida());
}

function avisar(txt){
  ultimoAviso = txt;
  if (tablero) dialog.showMessageBox(tablero, { type: 'warning', title: 'TRAZO v3', message: txt });
}

/* Título del tablero con el estado de la salida: cuántos cuadros por segundo
   llegan a Spout y por qué placa. Así se ve de un vistazo si anda. */
let ultimoConteo = 0;
setInterval(() => {
  if (!tablero || tablero.isDestroyed()) return;
  const fps = enviados - ultimoConteo;
  ultimoConteo = enviados;
  let t = 'TRAZO v3';
  if (!config.spout) t += '  ·  Spout apagado';
  else if (!spout) t += '  ·  Spout no disponible';
  else {
    const i = spout.info();
    t += '  ·  Spout "' + NOMBRE_SPOUT + '" ' + config.ancho + '×' + config.alto + '  ·  ' + fps + ' fps' +
         (config.alfa ? '  ·  fondo transparente' : '') + (config.modo === 'cpu' ? '  ·  modo compatible' : '') +
         (i.placa ? '  ·  ' + i.placa : '');
  }
  tablero.setTitle(t);
}, 1000);

/* ---------------- menú ---------------- */
function cambiar(k, v){
  config[k] = v;
  guardarConfig();
  crearSalida();
  armarMenu();
}

function armarMenu(){
  const res = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
  const plantilla = [
    { label: 'TRAZO', submenu: [
      { label: 'Recargar tablero', accelerator: 'CmdOrCtrl+R', click: () => tablero && tablero.reload() },
      { label: 'Pantalla completa', accelerator: 'F11', click: () => tablero && tablero.setFullScreen(!tablero.isFullScreen()) },
      { type: 'separator' },
      { label: 'Herramientas de desarrollo', accelerator: 'CmdOrCtrl+Shift+I', click: () => tablero && tablero.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: 'Salir', role: 'quit' }
    ] },
    { label: 'Salida Spout', submenu: [
      { label: 'Mandar a Resolume por Spout', type: 'checkbox', checked: config.spout, click: m => cambiar('spout', m.checked) },
      { label: 'Fondo transparente', type: 'checkbox', checked: config.alfa, click: m => cambiar('alfa', m.checked) },
      { type: 'separator' },
      ...res.map(([w, h]) => ({
        label: w + ' × ' + h, type: 'radio', checked: config.ancho === w && config.alto === h,
        click: () => { config.ancho = w; config.alto = h; guardarConfig(); crearSalida(); armarMenu(); }
      })),
      { type: 'separator' },
      { label: '30 cuadros por segundo', type: 'radio', checked: config.fps === 30, click: () => cambiar('fps', 30) },
      { label: '60 cuadros por segundo', type: 'radio', checked: config.fps === 60, click: () => cambiar('fps', 60) },
      { type: 'separator' },
      { label: 'Por placa de video (rápido)', type: 'radio', checked: config.modo === 'gpu', click: () => cambiar('modo', 'gpu') },
      { label: 'Modo compatible (por procesador)', type: 'radio', checked: config.modo === 'cpu', click: () => cambiar('modo', 'cpu') },
      { type: 'separator' },
      { label: 'Recargar la salida', click: () => crearSalida() },
      { label: 'Ver la salida en una ventana', click: () => {
          const v = new BrowserWindow({ width: 960, height: 540, title: 'TRAZO v3 · salida', backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } });
          v.loadURL(urlTablero() + '&salida=1');
        } },
      { label: 'Placas de video de esta máquina…', click: () => {
          const placas = spoutMod ? spoutMod.placas() : [];
          dialog.showMessageBox(tablero, { title: 'Placas de video', message: placas.length
            ? 'De la más potente a la menos:\n\n' + placas.join('\n') + (spout ? '\n\nSpout sale por: ' + spout.info().placa : '')
            : 'No pude leer las placas de video.' });
        } }
    ] },
    { label: 'Tablet', submenu: [
      { label: 'Dirección para la tablet…', click: () => dialog.showMessageBox(tablero, {
          title: 'Tablet', message: 'En la tablet, con la misma wifi, abrí:\n\n' + direccionesTablet().join('\n') +
            '\n\nLa que termina en .local no cambia aunque el router le dé otra IP a la PC.' }) }
    ] },
    { label: 'Ayuda', submenu: [
      { label: 'Instructivo de la app de escritorio', click: () => shell.openPath(path.join(__dirname, 'INSTRUCTIVO.txt')) },
      { label: 'LEEME de TRAZO v3', click: () => shell.openPath(path.join(RAIZ, 'LEEME.txt')) },
      { label: 'Abrir la carpeta de TRAZO v3', click: () => shell.openPath(RAIZ) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(plantilla));
}

/* ---------------- arranque ---------------- */
if (!app.requestSingleInstanceLock()){
  app.quit();
} else {
  app.on('second-instance', () => { if (tablero){ if (tablero.isMinimized()) tablero.restore(); tablero.focus(); } });

  app.whenReady().then(async () => {
    leerConfig();
    /* cámara, micrófono y MIDI: la página es la nuestra, en esta máquina */
    const permitidos = new Set(['media', 'midi', 'midiSysex', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((wc, permiso, responder) => responder(permitidos.has(permiso)));
    session.defaultSession.setPermissionCheckHandler((wc, permiso) => permitidos.has(permiso));

    armarMenu();
    if (!(await asegurarServidor())){
      dialog.showErrorBox('TRAZO v3', 'No pude levantar el servidor de TRAZO v3 en el puerto ' + PUERTO + '.\n\n' +
        'Si hay otro programa usando ese puerto, cerralo y volvé a abrir.');
      app.quit();
      return;
    }
    crearTablero();
    crearSalida();
    if (!spoutMod) avisar('No encuentro el módulo de Spout (' + spoutError + '). El tablero anda, pero no sale nada hacia Resolume.');
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    cerrarSalida();
    if (servidor){
      /* que guarde la escena antes de irse; si no contesta, se corta igual */
      try { servidor.send('salir'); } catch (err) { /* ya terminó */ }
      const s = servidor;
      setTimeout(() => { try { s.kill(); } catch (err) { /* ya terminó */ } }, 1500).unref();
    }
  });
}

