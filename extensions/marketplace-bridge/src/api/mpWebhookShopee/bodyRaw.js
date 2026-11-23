/** Captura o corpo bruto necessário para validar o push da Shopee. */

import bodyParser from 'body-parser';

export default function (request, response, next) {
  bodyParser.raw({ type: '*/*' })(request, response, next);
}
