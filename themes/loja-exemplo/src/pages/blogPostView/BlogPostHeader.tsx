import { useBlogPost } from '@components/frontStore/blog/BlogPostContext.js';
import React from 'react';
import { ArrowLeft, Calendar, Clock } from 'lucide-react';
import { quoteHref } from '../../components/frontStore/site.js';
import { HcIcon } from '../../components/frontStore/HcIcon.js';

/** Cabeçalho do artigo em pt-BR no slot `blogPostArticle`. */
export default function BlogPostHeader() {
  const post = useBlogPost();

  return (
    <header className="le-post-header">
      <a className="le-post-header__back" href="/blog">
        <ArrowLeft className="h-4 w-4" />
        Voltar ao blog
      </a>
      {post.category && (
        <a className="le-post-header__category" href={post.category.url}>
          {post.category.name}
        </a>
      )}
      <h1 className="le-post-header__title">{post.name}</h1>
      <div className="le-post-header__meta">
        {post.author?.fullName && <span>{post.author.fullName}</span>}
        {post.publishedAt && (
          <span className="le-post-header__meta-item">
            <Calendar className="h-4 w-4" />
            {new Date(post.publishedAt).toLocaleDateString('pt-BR')}
          </span>
        )}
        {post.readingTime ? (
          <span className="le-post-header__meta-item">
            <Clock className="h-4 w-4" />
            {post.readingTime} min de leitura
          </span>
        ) : null}
      </div>
      <a
        className="le-post-header__cta"
        href={quoteHref(`o artigo "${post.name}"`)}
        target="_blank"
        rel="noreferrer"
      >
        <HcIcon name="whatsapp" />
        Precisa de ajuda com este assunto? Fale com a Loja Exemplo
      </a>
    </header>
  );
}

export const layout = {
  areaId: 'blogPostArticle',
  sortOrder: 10
};
