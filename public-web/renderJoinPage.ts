import { renderPicklaMailJoinSignup } from "./renderMailSignup";
import { PUBLIC_WEB_ORIGIN } from "./registry";

function escapeHtml(value: string) {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#039;");
}

export const PICKLA_JOIN_PATH = "/join";
export const PICKLA_JOIN_CANONICAL = `${PUBLIC_WEB_ORIGIN}${PICKLA_JOIN_PATH}`;
export const PICKLA_JOIN_TITLE = "Join Pickla — News, events and community";
export const PICKLA_JOIN_DESCRIPTION = "Join Pickla news & community for events, people, things we're building and the occasional story worth reading.";

export function renderJoinPage({ logo }: { logo: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(PICKLA_JOIN_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PICKLA_JOIN_DESCRIPTION)}">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="${PICKLA_JOIN_CANONICAL}">
    <meta name="theme-color" content="#fffaf7">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Pickla">
    <meta property="og:title" content="${escapeHtml(PICKLA_JOIN_TITLE)}">
    <meta property="og:description" content="${escapeHtml(PICKLA_JOIN_DESCRIPTION)}">
    <meta property="og:url" content="${PICKLA_JOIN_CANONICAL}">
    <meta property="og:image" content="${PUBLIC_WEB_ORIGIN}/og-pickla.jpg">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(PICKLA_JOIN_TITLE)}">
    <meta name="twitter:description" content="${escapeHtml(PICKLA_JOIN_DESCRIPTION)}">
    <meta name="twitter:image" content="${PUBLIC_WEB_ORIGIN}/og-pickla.jpg">
    <link rel="icon" href="/favicon.ico">
    <style>
      :root{color-scheme:light;--ink:#071126;--paper:#fffaf7;--white:#fff;--pink:#f43278;--pink-text:#b62068;--mint:#32efa0;--muted:#566176;--line:rgba(7,17,38,.18)}
      *{box-sizing:border-box}html{background:var(--paper)}body{min-width:320px;margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit}.skip{position:fixed;z-index:10;left:-999px;top:10px;padding:12px 16px;background:var(--ink);color:var(--white)}.skip:focus{left:10px}.shell{width:min(1360px,calc(100% - 64px));margin-inline:auto}.masthead{display:flex;align-items:center;justify-content:space-between;min-height:104px;border-bottom:1px solid var(--line)}.brand{display:inline-flex;align-items:center}.brand img{display:block;width:116px;height:auto}.masthead__label{margin:0;color:var(--pink-text);font-size:11px;font-weight:850;letter-spacing:.2em;text-transform:uppercase}.join-main{min-height:calc(100vh - 105px)}.join-signup{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(380px,.62fr);min-height:calc(100vh - 105px)}.join-signup__editorial{display:flex;flex-direction:column;justify-content:center;padding:72px clamp(56px,7vw,112px) 76px 0}.join-signup__edition{margin:0 0 36px;color:var(--pink-text);font-size:12px;font-weight:850;letter-spacing:.2em;text-transform:uppercase}.join-signup h1{max-width:930px;margin:0;font-size:clamp(70px,8.6vw,132px);font-weight:950;letter-spacing:-.075em;line-height:.8}.join-signup h1 span{color:var(--pink)}.join-signup__dek{max-width:650px;margin:48px 0 0;color:#36415a;font-size:clamp(18px,1.6vw,23px);line-height:1.55}.join-signup__capture{display:flex;flex-direction:column;justify-content:center;padding:64px 0 64px clamp(48px,5vw,86px);border-left:1px solid var(--line)}.join-signup__number{margin:0 0 64px;color:var(--pink-text);font:800 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase}.join-signup__label{display:block;margin-bottom:12px;font-size:13px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.join-signup__form>input[type=email]{display:block;width:100%;min-height:58px;padding:0 4px;border:0;border-bottom:2px solid var(--ink);border-radius:0;background:transparent;color:var(--ink);font:600 clamp(18px,1.5vw,22px)/1.2 inherit}.join-signup__form>input[type=email]:focus{outline:0;border-bottom-color:var(--pink);box-shadow:0 3px 0 var(--pink)}.join-signup__consent{display:grid;grid-template-columns:20px 1fr;gap:12px;align-items:start;margin:24px 0 0;font-size:13px;font-weight:700;line-height:1.5}.join-signup__consent input{width:20px;height:20px;margin:0;accent-color:var(--pink)}.join-signup__form button{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:62px;margin-top:28px;padding:0 22px;border:0;border-radius:2px;background:var(--pink);color:var(--ink);font:900 14px/1 inherit;letter-spacing:.06em;cursor:pointer}.join-signup__form button:hover{background:#e82b70}.join-signup__form button:focus-visible,.join-signup__fine-print a:focus-visible{outline:3px solid var(--ink);outline-offset:3px}.join-signup__form button:disabled{cursor:wait;opacity:.66}.join-signup__status{min-height:24px;margin:14px 0 0;font-size:13px;line-height:1.5}.join-signup__status[data-state=success]{color:#087545;font-weight:800}.join-signup__status[data-state=error]{color:#a30f49;font-weight:800}.join-signup__fine-print{margin-top:34px;padding-top:24px;border-top:1px solid var(--line)}.join-signup__fine-print p{margin:0;color:var(--muted);font-size:11px;line-height:1.6}.join-signup__fine-print p:first-child{margin-bottom:8px;color:var(--ink);font-size:12px;font-weight:800}.join-signup__fine-print a{text-underline-offset:3px}.join-signup__trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.join-footer{border-top:1px solid var(--line)}.join-footer__inner{display:flex;align-items:center;justify-content:space-between;min-height:76px;color:var(--muted);font-size:11px}.join-footer p{margin:0}.join-footer nav{display:flex;gap:20px}.join-footer a{text-underline-offset:3px}
      @media(max-width:900px){.shell{width:min(100% - 36px,1360px)}.masthead{min-height:82px}.brand img{width:98px}.join-main,.join-signup{min-height:0}.join-signup{grid-template-columns:1fr}.join-signup__editorial{padding:58px 0 54px}.join-signup__edition{margin-bottom:28px}.join-signup h1{font-size:clamp(55px,15.8vw,88px);line-height:.82}.join-signup__dek{margin-top:34px;font-size:18px}.join-signup__capture{padding:46px 0 58px;border-top:1px solid var(--line);border-left:0}.join-signup__number{margin-bottom:40px}.join-footer__inner{align-items:flex-start;flex-direction:column;justify-content:center;gap:9px;padding:22px 0}.join-footer nav{gap:16px}}
      @media(max-width:420px){.shell{width:min(100% - 28px,1360px)}.masthead__label{font-size:9px;letter-spacing:.14em}.join-signup__editorial{padding-top:46px}.join-signup h1{font-size:clamp(52px,16.3vw,68px)}.join-signup__dek br{display:none}.join-signup__capture{padding-top:40px}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
    </style>
  </head>
  <body>
    <a class="skip" href="#join">Skip to signup</a>
    <header class="shell masthead">
      <a class="brand" href="/" aria-label="Pickla home"><img src="${escapeHtml(logo)}" width="345" height="103" alt="Pickla"></a>
      <p class="masthead__label">News &amp; community</p>
    </header>
    <main class="shell join-main" id="join">
      ${renderPicklaMailJoinSignup()}
    </main>
    <footer class="join-footer">
      <div class="shell join-footer__inner">
        <p>Pickla · Play, meet and belong.</p>
        <nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
      </div>
    </footer>
  </body>
</html>\n`;
}
