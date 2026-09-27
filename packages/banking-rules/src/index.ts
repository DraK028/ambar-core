/**
 * Reglas bancarias compartidas por la banca web y la app móvil: montos en centavos
 * (sin punto flotante) y CLABE con dígito verificador. El Ledger tiene su propia copia
 * en el dominio y se prueba con los mismos vectores.
 */
export * from './clabe';
export * from './money';
