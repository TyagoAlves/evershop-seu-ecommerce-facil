import { toast } from '@components/common/ui/Sonner.js';
import { CustomerLoginForm } from '@components/frontStore/customer/LoginForm.js';
import React from 'react';
import { HcIcon } from '../../components/frontStore/HcIcon.js';
import { SITE } from '../../components/frontStore/site.js';

type LoginPageProps = {
  homeUrl: string;
  registerUrl: string;
  forgotPasswordUrl: string;
};

/** Login da loja com o mesmo padrão azul/escuro das demais páginas. */
export default function LoginPage({
  homeUrl,
  registerUrl,
  forgotPasswordUrl
}: LoginPageProps) {
  const [redirectUrl, setRedirectUrl] = React.useState<string>(homeUrl);

  React.useEffect(() => {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      setRedirectUrl(redirect);
    }
  }, []);

  return (
    <div className="le-login">
      <div className="le-login__glow" aria-hidden="true" />
      <div className="le-container le-login__inner">
        <section className="le-login__intro">
          <span className="le-eyebrow">Área do cliente</span>
          <h2 className="le-login__headline">
            Sua conta, seus orçamentos.
          </h2>
          <p className="le-login__lead">
            Entre para acompanhar seus pedidos e montar sua lista de materiais.
            Como trabalhamos com preços sob consulta, valores e prazos são
            combinados direto pelo WhatsApp.
          </p>
          <ul className="le-login__benefits">
            <li>
              <HcIcon name="check" /> Listas de materiais sob consulta
            </li>
            <li>
              <HcIcon name="check" /> Atendimento próximo em Sua Cidade
            </li>
            <li>
              <HcIcon name="check" /> Retirada nas lojas 1 e 2
            </li>
          </ul>
          <a
            className="le-btn le-whatsapp le-btn--lg"
            href={SITE.whatsappHref}
            target="_blank"
            rel="noreferrer"
          >
            <HcIcon name="whatsapp" />
            Falar no WhatsApp
          </a>
          <p className="le-login__contact">
            <HcIcon name="phone" />
            <span>
              Ou ligue <a href={SITE.phoneHref}>{SITE.phone}</a> · {SITE.hours}
            </span>
          </p>
        </section>

        <section className="le-login__panel le-card">
          <CustomerLoginForm
            title="Entrar"
            subtitle="Bem-vindo de volta — entre na sua conta."
            redirectUrl={redirectUrl}
            onError={(error: any) => toast.error(error.message)}
            className="w-full"
          />
          <div className="le-login__options">
            <a href={forgotPasswordUrl}>Esqueceu sua senha?</a>
            <p>
              É novo por aqui? <a href={registerUrl}>Criar uma conta</a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export const layout = {
  areaId: 'content',
  sortOrder: 10
};

export const query = `
  query Query {
    homeUrl: url(routeId: "homepage")
    registerUrl: url(routeId: "register")
    forgotPasswordUrl: url(routeId: "resetPasswordPage")
  }
`;
