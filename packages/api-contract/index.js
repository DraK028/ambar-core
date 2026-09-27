const path = require('node:path');

/** Ruta absoluta al contrato, para herramientas y pruebas de contrato. */
module.exports = {
  openapiPath: path.join(__dirname, 'openapi.yaml'),
};
