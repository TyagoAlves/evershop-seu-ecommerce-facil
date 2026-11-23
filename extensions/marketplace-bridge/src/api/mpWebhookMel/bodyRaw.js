/** Captura o corpo bruto necessário para validar a assinatura do webhook. */

import bodyParser from 'body-parser';

export default function (request, response, next) {
  bodyParser.raw({ type: '*/*' })(request, response, next);
}
