/* Devuelve el QR de una dirección como data URL, para pegarlo en el cartel. */
const QR = require('qrcode');
const texto = process.argv[2] || '';
QR.toDataURL(texto, { margin: 1, scale: 10, errorCorrectionLevel: 'M',
  color: { dark: '#0b0d10ff', light: '#ffffffff' } })
  .then(url => process.stdout.write(url))
  .catch(() => process.exit(1));
