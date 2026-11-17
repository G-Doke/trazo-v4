# TRAZO v4

Tablero de dibujo para visuales en vivo: cada trazo queda grabado con su tiempo
y se repite en loop, cuantizado al BPM. Se dibuja desde la compu o desde una
tablet por wifi, y la salida va directo a Resolume por Spout. Es la última
versión de la herramienta que arrancó como PUNTERO.

## ⬇️ Descargar

**[Bajar TRAZO-v4.zip](https://github.com/G-Doke/trazo-v4/releases/latest/download/TRAZO-v4.zip)** (menos de 1 MB)

Para Windows 10 u 11 de 64 bits. La instalación se hace una sola vez y necesita
internet.

## Instalar

1. Bajá **TRAZO-v4.zip** con el link de arriba.
2. Descomprimilo: clic derecho en el .zip → **Extraer todo** → **Extraer**.
3. En la carpeta que queda, doble clic en **`INSTALAR TRAZO v4.bat`**.
   - Si aparece «Windows protegió tu PC»: **Más información** → **Ejecutar de todas formas**.
   - Baja el motor de la app (Electron, unos 150 MB) de su página oficial y
     revisa que sea idéntico al original antes de usarlo. Según la conexión,
     tarda unos minutos.
   - Cerca del final, Windows pregunta si deja hacer cambios: decí que **Sí**.
     Es el permiso del firewall para que la tablet se pueda conectar.
4. Listo: queda el acceso directo **TRAZO v4** en el escritorio y en el menú
   Inicio, y TRAZO se abre solo. La carpeta que bajaste ya no hace falta.

Si ya estaba instalado, el mismo instalador lo actualiza sin tocar la escena
guardada.

## Usar

- Doble clic en **TRAZO v4**, en el escritorio. Se abre el tablero y, al lado,
  un cartel con la dirección para la tablet y su QR.
- En la tablet, conectada **a la misma wifi** que la compu, escaneá el QR o
  escribí la dirección en Safari o Chrome. Si cambiás de red, la dirección
  cambia: usá siempre la que muestra el cartel.
- Para cerrar, cerrá la ventana del tablero: la escena se guarda sola.
- **Resolume:** TRAZO manda su salida por Spout, sin OBS. En Resolume aparece
  en *Sources → Spout Servers*. Más detalle en
  [`codigo/trazo/escritorio/INSTRUCTIVO.txt`](codigo/trazo/escritorio/INSTRUCTIVO.txt)
  (es de la v3: la instalación que describe ahí ya la hace el instalador).
- Todos los controles, pinceles, capas y atajos de teclado:
  [`codigo/trazo/LEEME.txt`](codigo/trazo/LEEME.txt).

## Si algo no anda

- **La tablet no se conecta:** tiene que estar en la misma wifi que la compu.
  Si Windows pregunta si deja a TRAZO usar la red, marcá las dos casillas y
  **Permitir**.
- **El instalador corta con un mensaje:** hacé lo que dice y volvé a abrirlo.
  Si sigue igual, el detalle queda en `trazo-v4-instalacion.log` (pegá `%TEMP%`
  en la barra del Explorador y está ahí).

## Qué instala y dónde

- TRAZO y Electron, en `%LOCALAPPDATA%\Programs\TRAZO v4` (no pide permisos de
  administrador para eso).
- Una regla del firewall, «TRAZO v4 (tablet)», para que la tablet llegue al
  servidor de TRAZO.
- La preferencia de Windows para que use la placa de video de alto rendimiento
  (en notebooks con dos placas, la misma que usa Resolume).
- Los accesos directos del escritorio y del menú Inicio.

Para desinstalarlo: borrar esa carpeta y los dos accesos directos, y la regla
«TRAZO v4 (tablet)» en *Firewall de Windows Defender con seguridad avanzada*.

## Qué hay en este repositorio

| | |
|---|---|
| `INSTALAR TRAZO v4.bat` | el instalador de doble clic |
| `trazo-v4.zip` | TRAZO v4 empaquetado: el tablero, el servidor, la app de escritorio con Spout y el lanzador con el cartel de la tablet |
| `LEEME.txt` | los pasos de instalación, en texto |
| `codigo/` | lo mismo que trae `trazo-v4.zip`, suelto para verlo en la web (sin las librerías del lanzador) |

El botón verde **Code → Download ZIP** de esta página también sirve: trae el
instalador y el paquete juntos.

Spout2 es de Lynn Jarvis y va con su licencia BSD en
[`codigo/trazo/escritorio/spout/LICENSE-Spout2.txt`](codigo/trazo/escritorio/spout/LICENSE-Spout2.txt).
Electron se baja de su página oficial durante la instalación.
