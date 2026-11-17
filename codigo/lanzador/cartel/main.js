/**
 * TRAZO v4 — el cartel con la dirección para la tablet, en una ventana propia.
 *
 * lanzar-trazo.ps1 arma el HTML en %TEMP%\trazo-v4-cartel.html y abre esto
 * con el mismo electron.exe de TRAZO: así el cartel sale aunque la compu no
 * tenga Chrome. Si ya estaba abierto, vuelve a leer el archivo y se pone al
 * frente, en vez de abrir otro.
 */
'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const os = require('os');

const CARTEL = path.join(os.tmpdir(), 'trazo-v4-cartel.html');
let ventana = null;

if (!app.requestSingleInstanceLock()){
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!ventana) return;
    ventana.loadFile(CARTEL);
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ventana = new BrowserWindow({
      width: 900, height: 760, minWidth: 560, minHeight: 420,
      title: 'TRAZO v4', backgroundColor: '#0b0d10', autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'TRAZO-v4.ico')
    });
    ventana.loadFile(CARTEL);
    ventana.on('closed', () => { ventana = null; });
  });

  app.on('window-all-closed', () => app.quit());
}
