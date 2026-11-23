// Limitador de requisições por marketplace/chave, sem dependências externas.
// Usa token bucket com fila FIFO: chamadas concorrentes aguardam a vez e o
// bucket é reabastecido continuamente conforme a taxa configurada.
//
// Os padrões abaixo são conservadores e NÃO devem ser tratados como limites
// oficiais: cada adaptador precisa informar os valores vigentes na documentação
// do marketplace para aquele endpoint/conta (por exemplo, N requisições por
// minuto) ao criar ou configurar o limitador.

// Valor genérico de segurança usado enquanto o adaptador não configura a taxa.
const LIMITE_CONSERVADOR = Object.freeze({
  capacidade: 5,
  reposicaoPorSegundo: 5
});

const CHAVE_PADRAO = 'default';
const limitadores = new Map();

/** Relógio monotônico quando disponível, para não sofrer com ajustes do sistema. */
function agoraMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Pausa local: evita acoplar este módulo à camada HTTP e às classes de erro. */
function pausar(ms) {
  const tempo = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms) : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, tempo);
  });
}

function inteiroPositivo(valor, padrao) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 1) {
    return padrao;
  }
  return Math.floor(valor);
}

function taxaPositiva(valor, padrao) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    return padrao;
  }
  return valor;
}

function normalizarConfig(opcoes = {}) {
  return {
    capacidade: inteiroPositivo(opcoes.capacidade, LIMITE_CONSERVADOR.capacidade),
    reposicaoPorSegundo: taxaPositiva(
      opcoes.reposicaoPorSegundo,
      LIMITE_CONSERVADOR.reposicaoPorSegundo
    )
  };
}

/** Cópia dos padrões conservadores, para não expor o objeto congelado interno. */
export function limitesPadrao() {
  return { ...LIMITE_CONSERVADOR };
}

/**
 * Converte um limite por janela (ex.: 100 requisições por minuto) na forma
 * usada pelo token bucket. Valores inválidos caem no padrão conservador.
 */
export function limiterFromWindow(requisicoes, janelaMs) {
  const total = Number(requisicoes);
  const janela = Number(janelaMs);
  if (
    !Number.isFinite(total) || total <= 0 ||
    !Number.isFinite(janela) || janela <= 0
  ) {
    return limitesPadrao();
  }
  return {
    capacidade: Math.max(1, Math.floor(total)),
    reposicaoPorSegundo: total / (janela / 1000)
  };
}

/**
 * Cria um limitador independente.
 *
 * @param {object} [opcoes]
 * @param {number} [opcoes.capacidade] Burst máximo de requisições.
 * @param {number} [opcoes.reposicaoPorSegundo] Tokens repostos por segundo.
 * @param {string} [opcoes.nome] Rótulo apenas para observabilidade.
 * @returns {{acquire: Function, tryAcquire: Function, run: Function,
 *   reset: Function, snapshot: Function}}
 */
export function createLimiter(opcoes = {}) {
  const { capacidade, reposicaoPorSegundo } = normalizarConfig(opcoes);
  const nome = typeof opcoes.nome === 'string' && opcoes.nome
    ? opcoes.nome
    : 'sem-nome';
  let tokens = capacidade;
  let ultimaReposicao = agoraMs();
  let pendentes = 0;
  let fila = Promise.resolve();

  /** Reposi proporcional ao tempo decorrido, limitada à capacidade. */
  function repor() {
    const agora = agoraMs();
    const decorridoSegundos = Math.max(0, agora - ultimaReposicao) / 1000;
    ultimaReposicao = agora;
    tokens = Math.min(capacidade, tokens + decorridoSegundos * reposicaoPorSegundo);
  }

  /** Consome um token ou espera até que um esteja disponível. */
  async function aguardarToken() {
    for (;;) {
      repor();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      const falta = 1 - tokens;
      const esperaMs = Math.max(1, Math.ceil((falta / reposicaoPorSegundo) * 1000) + 1);
      await pausar(esperaMs);
    }
  }

  /**
   * Reserva uma vez na fila. A fila nunca é contaminada por falha de chamador.
   */
  function acquire() {
    pendentes += 1;
    const resultado = fila.then(aguardarToken).finally(() => {
      pendentes -= 1;
    });
    fila = resultado.catch(() => {});
    return resultado;
  }

  /**
   * Tentativa sem espera: não respeita a fila e falha imediatamente se não
   * houver token. Útil quando o chamador prefere descartar a operação.
   */
  function tryAcquire() {
    repor();
    if (tokens < 1) {
      return false;
    }
    tokens -= 1;
    return true;
  }

  /** Executa `fn` depois de obter um token e devolve o resultado dela. */
  async function run(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Informe uma função para executar sob o limite.');
    }
    await acquire();
    return fn();
  }

  /** Volta ao bucket cheio; não cancela chamadas já enfileiradas. */
  function reset() {
    tokens = capacidade;
    ultimaReposicao = agoraMs();
  }

  /** Retrato do estado atual, sem dados de requisição nem segredos. */
  function snapshot() {
    repor();
    return {
      nome,
      capacidade,
      reposicaoPorSegundo,
      tokensDisponiveis: Math.floor(tokens),
      pendentes
    };
  }

  return Object.freeze({ acquire, tryAcquire, run, reset, snapshot });
}

/** Identificador determinístico e sem segredos para o par marketplace/chave. */
function idDoLimitador(marketplace, chave) {
  const nomeMarketplace = typeof marketplace === 'string' && marketplace
    ? marketplace
    : 'desconhecido';
  const nomeChave = typeof chave === 'string' && chave ? chave : CHAVE_PADRAO;
  return `${nomeMarketplace.toLowerCase()}:${nomeChave.toLowerCase()}`;
}

/**
 * Cria (ou substitui) o limitador registrado para marketplace/chave.
 * A configuração deve ser feita no bootstrap do adaptador, antes da fila ativa:
 * substituir um limitador em uso não cancela esperas já pendentes.
 */
export function configureLimiter(marketplace, chave = CHAVE_PADRAO, opcoes = {}) {
  const id = idDoLimitador(marketplace, chave);
  const limitador = createLimiter({ nome: id, ...limitesPadrao(), ...opcoes });
  limitadores.set(id, limitador);
  return limitador;
}

/**
 * Obtém o limitador registrado. A primeira chamada define a configuração;
 * chamadas seguintes reaproveitam o mesmo bucket para não perder a fila.
 */
export function getLimiter(marketplace, chave = CHAVE_PADRAO, opcoes = {}) {
  const id = idDoLimitador(marketplace, chave);
  return limitadores.get(id) ?? configureLimiter(marketplace, chave, opcoes);
}

/** Espera a vez de marketplace/chave antes de prosseguir. */
export async function acquireSlot(marketplace, chave = CHAVE_PADRAO, opcoes = {}) {
  await getLimiter(marketplace, chave, opcoes).acquire();
}

/** Reserva imediata: retorna `false` quando não há token disponível. */
export function tryAcquireSlot(marketplace, chave = CHAVE_PADRAO, opcoes = {}) {
  return getLimiter(marketplace, chave, opcoes).tryAcquire();
}

/** Envolve uma operação inteira com a reserva de token de marketplace/chave. */
export async function runWithLimit(marketplace, chave, funcao, opcoes = {}) {
  return getLimiter(marketplace, chave, opcoes).run(funcao);
}

/** Limpa o registro (útil em testes ou recarga de configuração). */
export function resetLimiters() {
  limitadores.clear();
}

/** Estados dos limitadores registrados, para painel de observabilidade. */
export function listLimiterSnapshots() {
  return Array.from(limitadores.values(), (limitador) => limitador.snapshot());
}
