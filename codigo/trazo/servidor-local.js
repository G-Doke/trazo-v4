/**
 * TRAZO v3 — servidor local, sin internet y sin instalar nada.
 *
 *     node servidor-local.js            (puerto 8791)
 *     node servidor-local.js --puerto=8796 --sala=prueba
 *
 * Sirve la página y sincroniza la PC con la tablet dentro de la misma wifi,
 * aunque esa wifi no tenga salida a internet. Es el servidor de PUNTERO con
 * tres agregados:
 *
 *   - guarda la escena compartida en un archivo al lado suyo, así un corte no
 *     se lleva lo dibujado;
 *   - guarda las imágenes cargadas como fuente, para que una tablet que entra
 *     tarde las reciba;
 *   - reparte los cuadros de la cámara de la PC (livianos, unos por segundo)
 *     sin guardarlos, así la tablet ve lo mismo que sale por el proyector.
 *
 * Solo módulos que ya vienen con Node: nada de npm install.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const argPuerto = process.argv.find(a => a.startsWith('--puerto='));
const PUERTO = Number(argPuerto ? argPuerto.slice(9) : process.env.PORT) || 8791;

/* Sala por defecto: quien entre a la raíz cae acá. Desde la tablet alcanza
   con tipear la IP y el puerto. */
const SALA_POR_DEFECTO = (() => {
  const arg = process.argv.find(a => a.startsWith('--sala='));
  const v = arg ? arg.slice(7) : 'vivo';
  return v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'vivo';
})();
/* Con --archivo=index-b.html el mismo servidor sirve la versión B, en su
   propio puerto y con su propia escena. */
const argArchivo = process.argv.find(a => a.startsWith('--archivo='));
const ARCHIVO = path.join(__dirname, (argArchivo ? argArchivo.slice(10) : 'index.html').replace(/[^A-Za-z0-9_.-]/g, ''));
// un archivo por puerto: un servidor de prueba no le pisa la escena al de verdad
const ARCHIVO_ESCENA = path.join(__dirname, 'escena-compartida-' + PUERTO + '.json');
/* v3: la escena con la que arranca una máquina nueva (viaja en el repo). Se
   lee solo si todavía no hay escena guardada; después manda la de arriba. */
const ARCHIVO_ESCENA_INICIAL = path.join(__dirname, 'escena-inicial.json');
const MAX_TRAZOS = 1500;    // techo por sala (diez escenas de diez capas)
const PODA_CADA = 25;       // cada cuántos trazos se revisa el techo
const MAX_MENSAJE = 16 * 1024 * 1024;   // una imagen de fuente pesa
/* v3: las secuencias suman hasta 24 imágenes cada una */
const MAX_FUENTES = 240;
/* v3: los videos se suben a una carpeta al lado del servidor y se piden por
   /medio/<fid>. No viajan por el canal de la sala: pesan demasiado. */
const CARPETA_MEDIOS = path.join(__dirname, 'medios');
const MAX_VIDEO = 1024 * 1024 * 1024;   // 1 GB
const TIPOS_VIDEO = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv', 'video/x-m4v': 'm4v' };
const TIPO_DE_EXT = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', m4v: 'video/mp4' };
const FID_VALIDO = /^[A-Za-z0-9_-]{1,48}$/;
const COLA_CAM = 1.5 * 1024 * 1024;     // si la tablet viene atrasada, se saltea cuadros
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* ============================================================
   Salas
   ============================================================ */
const salas = new Map();

function sala(nombre) {
  let s = salas.get(nombre);
  if (!s) {
    s = { clientes: new Set(), trazos: new Map(), vista: null, fuentes: new Map(), desdePoda: 0 };
    salas.set(nombre, s);
  }
  return s;
}

function repartir(s, texto, excepto) {
  for (const c of s.clientes) {
    if (c === excepto) continue;
    try { enviar(c, texto); } catch (err) { /* se cayó; se limpia solo */ }
  }
}

function anunciar(s) {
  const msg = JSON.stringify({ e: 'peers', n: s.clientes.size });
  for (const c of s.clientes) {
    try { enviar(c, msg); } catch (err) { /* ídem */ }
  }
}

function podar(s) {
  if (s.trazos.size <= MAX_TRAZOS) return [];
  const sobran = s.trazos.size - MAX_TRAZOS;
  const ids = [];
  for (const id of s.trazos.keys()) {          // Map conserva orden de inserción
    ids.push(id);
    if (ids.length >= sobran) break;
  }
  for (const id of ids) s.trazos.delete(id);
  return ids;
}

/* Las fuentes que ninguna capa usa se sueltan: la vista trae la lista de las
   que están en uso en cualquiera de las diez escenas. Solo se poda con una
   vista nueva: una imagen recién llegada todavía no figura en la vista
   anterior, y podarla ahí la borraba antes de que su capa la nombrara. */
function podarFuentes(s, porVista) {
  const usadas = porVista && s.vista && Array.isArray(s.vista.fids) ? new Set(s.vista.fids) : null;
  if (usadas) {
    for (const fid of [...s.fuentes.keys()]) if (!usadas.has(fid)) s.fuentes.delete(fid);
  }
  while (s.fuentes.size > MAX_FUENTES) s.fuentes.delete(s.fuentes.keys().next().value);
}

function manejarMensaje(cli, texto) {
  let m;
  try { m = JSON.parse(texto); } catch (err) { return; }
  if (!m || typeof m.e !== 'string') return;
  const s = cli.sala;

  switch (m.e) {
    case 'cam':
      // cuadro de cámara: se reparte y se olvida; al que viene atrasado se le saltea
      for (const c of s.clientes) {
        if (c === cli) continue;
        if (c.socket.writableLength > COLA_CAM) continue;
        try { enviar(c, texto); } catch (err) { /* se limpia solo */ }
      }
      return;

    case 'up':
      if (m.st && Array.isArray(m.st.p) && m.id) {
        s.trazos.delete(m.id);                 // reenvío: va al final
        s.trazos.set(m.id, m.st);
        if (++s.desdePoda >= PODA_CADA) {
          s.desdePoda = 0;
          const caidos = podar(s);
          if (caidos.length) repartir(s, JSON.stringify({ e: 'drop', ids: caidos }), null);
        }
        guardarPronto();
      }
      break;

    case 'undo':
      s.trazos.delete(m.id);
      guardarPronto();
      break;

    case 'clearLayer':
      for (const [id, t] of s.trazos) {
        if (t && t.ly === m.layer && (t.sc | 0) === (m.sc | 0)) s.trazos.delete(id);
      }
      guardarPronto();
      break;

    case 'clearScene':
      for (const [id, t] of s.trazos) {
        if (t && (t.sc | 0) === (m.sc | 0)) s.trazos.delete(id);
      }
      guardarPronto();
      break;

    case 'view':
      if (m.v && typeof m.v === 'object') {
        s.vista = m.v;
        podarFuentes(s, true);
        guardarPronto();
      }
      break;

    /* Cambio de UNA capa: cada pantalla manda nada más que la capa que tocó,
       así lo de la tablet y lo de la PC no se pisan. Se mezcla en la vista
       guardada para que quien entre después la vea como quedó. */
    case 'capa':
      if (m.d && typeof m.d === 'object' && s.vista && Array.isArray(s.vista.scenes)) {
        const capas = s.vista.scenes[m.sc | 0];
        if (capas && capas[m.ly | 0]) {
          capas[m.ly | 0] = m.d;
          guardarPronto();
        }
      }
      break;

    case 'fuente':
      if (typeof m.fid === 'string' && typeof m.src === 'string' &&
          (m.src.startsWith('data:image/') || /^\/medio\/[A-Za-z0-9_-]{1,48}$/.test(m.src))) {
        s.fuentes.delete(m.fid);
        s.fuentes.set(m.fid, { fid: m.fid, nombre: String(m.nombre || '').slice(0, 80), src: m.src });
        podarFuentes(s, false);
        guardarPronto();
      }
      break;
  }

  repartir(s, texto, cli);
}

/* ============================================================
   Disco: la escena compartida sobrevive a un corte del servidor
   ============================================================ */
let guardando = null;
function guardarPronto() {
  if (guardando) return;
  guardando = setTimeout(guardarYa, 1500);
}
function guardarYa() {
  guardando = null;
  const datos = { v: 1, salas: {} };
  for (const [nombre, s] of salas) {
    if (!s.trazos.size && !s.vista && !s.fuentes.size) continue;
    datos.salas[nombre] = { trazos: [...s.trazos.entries()], vista: s.vista, fuentes: [...s.fuentes.values()] };
  }
  const tmp = ARCHIVO_ESCENA + '.tmp';
  fs.writeFile(tmp, JSON.stringify(datos), (err) => {
    if (err) { console.error('  no pude guardar la escena:', err.message); return; }
    fs.rename(tmp, ARCHIVO_ESCENA, (err2) => {
      if (err2) console.error('  no pude guardar la escena:', err2.message);
    });
  });
}
function cargarDisco() {
  try {
    const archivo = fs.existsSync(ARCHIVO_ESCENA) ? ARCHIVO_ESCENA : ARCHIVO_ESCENA_INICIAL;
    const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    let n = 0;
    for (const [nombre, d] of Object.entries(datos.salas || {})) {
      const s = sala(nombre);
      for (const [id, st] of d.trazos || []) { s.trazos.set(id, st); n++; }
      s.vista = d.vista || null;
      for (const f of d.fuentes || []) if (f && f.fid) s.fuentes.set(f.fid, f);
    }
    return n;
  } catch (err) {
    return -1;
  }
}

/* ============================================================
   WebSocket a mano (RFC 6455, solo lo que hace falta)
   ============================================================ */
function enviar(cli, texto) {
  const datos = Buffer.from(texto, 'utf8');
  const n = datos.length;
  let cab;
  if (n < 126) {
    cab = Buffer.from([0x81, n]);
  } else if (n < 65536) {
    cab = Buffer.alloc(4);
    cab[0] = 0x81; cab[1] = 126; cab.writeUInt16BE(n, 2);
  } else {
    cab = Buffer.alloc(10);
    cab[0] = 0x81; cab[1] = 127;
    cab.writeUInt32BE(0, 2); cab.writeUInt32BE(n, 6);
  }
  cli.socket.write(Buffer.concat([cab, datos]));
}

function marcoSimple(opcode) {
  return Buffer.from([0x80 | opcode, 0]);
}

/* Un marco puede llegar partido en varios pedazos de TCP, y un mensaje puede
   venir fragmentado en varios marcos: hay que acumular en los dos niveles. */
function procesarBuffer(cli) {
  for (;;) {
    const b = cli.buf;
    if (b.length < 2) return;

    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const enmascarado = (b[1] & 0x80) !== 0;
    let largo = b[1] & 0x7f;
    let off = 2;

    if (largo === 126) {
      if (b.length < 4) return;
      largo = b.readUInt16BE(2); off = 4;
    } else if (largo === 127) {
      if (b.length < 10) return;
      const alto = b.readUInt32BE(2);
      largo = alto * 4294967296 + b.readUInt32BE(6);
      off = 10;
    }
    if (largo > MAX_MENSAJE) { cerrar(cli); return; }

    const mascara = enmascarado ? off : -1;
    if (enmascarado) off += 4;
    if (b.length < off + largo) return;        // falta cuerpo: esperar más TCP

    const cuerpo = Buffer.allocUnsafe(largo);
    b.copy(cuerpo, 0, off, off + largo);
    if (enmascarado) {
      for (let i = 0; i < largo; i++) cuerpo[i] ^= b[mascara + (i & 3)];
    }
    cli.buf = b.subarray(off + largo);

    if (opcode === 0x8) { cerrar(cli); return; }
    if (opcode === 0x9) { cli.socket.write(marcoSimple(0xa)); continue; }  // ping
    if (opcode === 0xa) { cli.vivo = true; continue; }                     // pong

    if (opcode === 0x1 || opcode === 0x0) {
      cli.partes.push(cuerpo);
      if (fin) {
        const texto = Buffer.concat(cli.partes).toString('utf8');
        cli.partes = [];
        try { manejarMensaje(cli, texto); } catch (err) { console.error('mensaje:', err.message); }
      }
      continue;
    }
    // binario u opcode desconocido: se ignora
  }
}

function cerrar(cli) {
  if (cli.cerrado) return;
  cli.cerrado = true;
  cli.sala.clientes.delete(cli);
  try { cli.socket.destroy(); } catch (err) { /* ya estaba */ }
  anunciar(cli.sala);
}

/* ============================================================
   HTTP
   ============================================================ */
function direcciones() {
  const salida = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) salida.push(i.address);
    }
  }
  return salida;
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // el iniciar.bat pregunta acá si el que escucha en el puerto es este servidor
  if (url.pathname === '/estado') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('TRAZO3_SERVIDOR ' + PUERTO);
    return;
  }
  if (url.pathname === '/medio' && req.method === 'POST') { subirMedio(req, res, url); return; }
  if (url.pathname.startsWith('/medio/')) { servirMedio(req, res, url.pathname.slice(7)); return; }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('no encontrado');
    return;
  }
  // Sin sala en la URL, se manda a la de por defecto: los dos aparatos
  // entran a la misma escena con solo escribir la dirección.
  if (!url.searchParams.get('sala')) {
    res.writeHead(302, { Location: '/?sala=' + SALA_POR_DEFECTO });
    res.end();
    return;
  }
  fs.readFile(ARCHIVO, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('no encuentro index.html al lado de este script');
      return;
    }
    // la marca le avisa a la página que la sirvió este servidor, y le pasa
    // las direcciones para mostrarlas en el cartel de la tablet
    const dirs = direcciones().map(ip => 'http://' + ip + ':' + PUERTO);
    dirs.push('http://' + os.hostname().toLowerCase() + '.local:' + PUERTO);
    html = html.replace('<!--red-->', '<script>window.TRAZO_RED=' + JSON.stringify({ dirs }) + '</script>');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(html);
  });
});

/* ============================================================
   Medios (v3): videos subidos desde el panel de fuente o de punta
   ============================================================ */
function responder(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function archivoDeMedio(fid) {
  if (!FID_VALIDO.test(fid)) return null;
  try {
    const nombre = fs.readdirSync(CARPETA_MEDIOS).find(n => n.startsWith(fid + '.') && !n.endsWith('.tmp'));
    return nombre ? path.join(CARPETA_MEDIOS, nombre) : null;
  } catch (err) {
    return null;
  }
}

function subirMedio(req, res, url) {
  const fid = url.searchParams.get('fid') || '';
  const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = TIPOS_VIDEO[tipo];
  if (!FID_VALIDO.test(fid) || !ext) { responder(res, 400, { error: 'fid o tipo de video inválido' }); return; }
  const largo = Number(req.headers['content-length'] || 0);
  if (largo > MAX_VIDEO) { responder(res, 413, { error: 'el video pesa más de 1 GB' }); return; }
  try { fs.mkdirSync(CARPETA_MEDIOS, { recursive: true }); } catch (err) { /* ya existe */ }
  const final = path.join(CARPETA_MEDIOS, fid + '.' + ext);
  const tmp = final + '.tmp';
  const salida = fs.createWriteStream(tmp);
  let recibidos = 0, cortado = false;
  req.on('data', (trozo) => {
    recibidos += trozo.length;
    if (recibidos > MAX_VIDEO && !cortado) {
      cortado = true;
      req.unpipe(salida);
      salida.destroy();
      fs.unlink(tmp, () => {});
      responder(res, 413, { error: 'el video pesa más de 1 GB' });
      req.destroy();
    }
  });
  req.pipe(salida);
  salida.on('finish', () => {
    if (cortado) return;
    fs.rename(tmp, final, (err) => {
      if (err) { responder(res, 500, { error: 'no pude guardar el video' }); return; }
      console.log('  Video subido: ' + path.basename(final) + ' (' + Math.round(recibidos / 1048576) + ' MB)');
      responder(res, 200, { url: '/medio/' + fid });
    });
  });
  salida.on('error', () => { if (!cortado) responder(res, 500, { error: 'no pude guardar el video' }); });
}

/* Con rangos (206): sin esto el navegador no puede loopear ni saltar en el video */
function servirMedio(req, res, fid) {
  const archivo = archivoDeMedio(fid);
  if (!archivo) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('no encontrado'); return; }
  fs.stat(archivo, (err, info) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const tipo = TIPO_DE_EXT[path.extname(archivo).slice(1)] || 'application/octet-stream';
    const total = info.size;
    const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rango) {
      let desde = rango[1] === '' ? total - Number(rango[2]) : Number(rango[1]);
      let hasta = rango[1] !== '' && rango[2] !== '' ? Number(rango[2]) : total - 1;
      if (isNaN(desde) || desde < 0) desde = 0;
      if (hasta >= total) hasta = total - 1;
      if (desde > hasta) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + total });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=3600',
        'Content-Range': 'bytes ' + desde + '-' + hasta + '/' + total, 'Content-Length': hasta - desde + 1
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(archivo, { start: desde, end: hasta }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=3600', 'Content-Length': total });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(archivo).pipe(res);
  });
}

servidor.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  const clave = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !clave) { socket.destroy(); return; }

  const nombre = (url.searchParams.get('sala') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  if (!nombre) { socket.destroy(); return; }

  const aceptar = crypto.createHash('sha1').update(clave + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + aceptar + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const s = sala(nombre);
  const cli = { socket, sala: s, buf: Buffer.alloc(0), partes: [], vivo: true, cerrado: false };
  s.clientes.add(cli);

  socket.on('data', (chunk) => {
    cli.buf = cli.buf.length ? Buffer.concat([cli.buf, chunk]) : chunk;
    try { procesarBuffer(cli); } catch (err) { console.error('marco:', err.message); cerrar(cli); }
  });
  socket.on('error', () => cerrar(cli));
  socket.on('close', () => cerrar(cli));

  enviar(cli, JSON.stringify({
    e: 'init',
    trazos: [...s.trazos.values()],
    vista: s.vista,
    fuentes: [...s.fuentes.values()]
  }));
  anunciar(s);
});

/* Ping periódico: sin esto una tablet que se va de la wifi queda contada como
   presente hasta que el sistema operativo se dé cuenta, que puede tardar. */
setInterval(() => {
  for (const s of salas.values()) {
    for (const cli of s.clientes) {
      if (!cli.vivo) { cerrar(cli); continue; }
      cli.vivo = false;
      try { cli.socket.write(marcoSimple(0x9)); } catch (err) { cerrar(cli); }
    }
  }
}, 30000);

// al cerrar la ventana del servidor, lo último se escribe igual
function salir() { if (guardando) { clearTimeout(guardando); guardarYaSinc(); } process.exit(0); }
function guardarYaSinc() {
  try {
    const datos = { v: 1, salas: {} };
    for (const [nombre, s] of salas) {
      datos.salas[nombre] = { trazos: [...s.trazos.entries()], vista: s.vista, fuentes: [...s.fuentes.values()] };
    }
    fs.writeFileSync(ARCHIVO_ESCENA, JSON.stringify(datos));
  } catch (err) { /* nada que hacer */ }
}
process.on('SIGINT', salir);
/* Levantado por la app de escritorio: al cerrarla avisa por acá, porque en
   Windows matar el proceso no deja guardar lo último. */
process.on('message', (m) => { if (m === 'salir') salir(); });
process.on('SIGTERM', salir);
process.on('SIGHUP', salir);

const recuperados = cargarDisco();

servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('  El puerto ' + PUERTO + ' ya lo está usando otro programa.');
    console.log('  Casi siempre es un servidor de TRAZO que quedó abierto: cerralo y volvé a abrir.');
    console.log('');
  } else {
    console.error(err);
  }
  process.exit(1);
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  const ips = direcciones();
  console.log('');
  console.log('  TRAZO v3 — servidor local');
  console.log('  ─────────────────────────────────────────────');
  console.log('  En esta PC:      http://localhost:' + PUERTO);
  if (ips.length) {
    console.log('');
    console.log('  Desde la tablet, en la misma wifi:');
    for (const ip of ips) console.log('      http://' + ip + ':' + PUERTO);
    /* El nombre .local lo resuelve iOS solo y NO cambia aunque cambie la IP:
       es la dirección para dejar guardada en la tablet. */
    console.log('');
    console.log('  Dirección estable (esta no cambia nunca):');
    console.log('      http://' + os.hostname().toLowerCase() + '.local:' + PUERTO);
  } else {
    console.log('');
    console.log('  Sin red detectada: conectá la wifi o prendé el hotspot.');
  }
  console.log('');
  if (recuperados > 0) console.log('  Recuperé la escena guardada: ' + recuperados + ' trazos.');
  console.log('  La escena compartida se guarda en ' + path.basename(ARCHIVO_ESCENA));
  console.log('  Para cortar: cerrá esta ventana.');
  console.log('');
});
