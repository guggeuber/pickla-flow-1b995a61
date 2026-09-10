const B2B_EMAIL = "hello@picklaparks.com";

export function picklaBusinessContactHref(slug: string) {
  const subject = encodeURIComponent("Företag med Pickla");
  const body = encodeURIComponent(`Hej Pickla,\n\nVi vill prata om ett bredare eller återkommande företagsupplägg.\n\nAnläggning: ${slug}\n`);
  return `mailto:${B2B_EMAIL}?subject=${subject}&body=${body}`;
}
