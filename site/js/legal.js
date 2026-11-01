i18n.ready.then(() => {
  const articles = [...document.querySelectorAll("main.legal > article")];
  const shown = articles.find(article => article.lang === i18n.file) || articles.find(article => article.lang === "en");
  for (const article of articles) article.hidden = article !== shown;
});
