export type PicklaMailSignupSource = 'public_web' | 'public_web_root' | 'event_editorial';

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

function renderSignupScript(source: PicklaMailSignupSource, endpoint: string) {
  return `<script>(function(){var s=document.currentScript,r=s.previousElementSibling,f=r.querySelector("form"),o=r.querySelector("[role=status]"),b=f.querySelector("button");f.addEventListener("submit",async function(e){e.preventDefault();o.textContent="";o.removeAttribute("data-state");if(!f.reportValidity())return;b.disabled=true;var d=new FormData(f);try{var x=await fetch(${JSON.stringify(endpoint)},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:d.get("email"),consent:d.get("consent")==="on",audience:"adult_or_parent_guardian",website:d.get("website"),source:${JSON.stringify(escapeHtml(source))}})});if(!x.ok)throw 0;f.reset();o.dataset.state="success";o.textContent="Check your inbox to confirm."}catch(e){o.dataset.state="error";o.textContent="That didn't work. Please try again in a little while."}finally{b.disabled=false}})})();</script>`;
}

/**
 * Reusable, dependency-free Public Web capture block. Public requests stay on
 * the Pickla origin so the Vercel WAF and server-side proxy gate cannot be
 * bypassed by browser code.
 */
export function renderPicklaMailSignup({
  source = 'public_web',
  endpoint = '/mail/subscribe',
}: {
  source?: PicklaMailSignupSource;
  endpoint?: string;
} = {}) {
  return `<section class="pickla-mail" data-pickla-mail-signup>
    <div class="pickla-mail__copy">
      <p class="pickla-mail__eyebrow">Pickla</p>
      <h2>STAY IN THE PICKLA LOOP <span aria-hidden="true">🥒</span></h2>
      <p>Events, community, new things we're building and the occasional story worth reading.</p>
    </div>
    <form class="pickla-mail__form" novalidate>
      <label class="pickla-mail__label" for="pickla-mail-email">Email</label>
      <div class="pickla-mail__row">
        <input id="pickla-mail-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="320" required aria-describedby="pickla-mail-consent pickla-mail-status">
        <button type="submit">JOIN PICKLA</button>
      </div>
      <div class="pickla-mail__trap" aria-hidden="true"><label>Webbplats<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
      <label class="pickla-mail__consent" id="pickla-mail-consent">
        <input name="consent" type="checkbox" required>
        <span>Yes, send me Pickla news &amp; community.</span>
      </label>
      <p class="pickla-mail__notice">For adults 18+. Communication concerning children is handled by a parent or guardian. Unsubscribe anytime. See our <a href="/privacy">privacy policy</a>.</p>
      <p class="pickla-mail__status" id="pickla-mail-status" role="status" aria-live="polite"></p>
    </form>
    <style>
      .pickla-mail{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.8fr);gap:clamp(28px,6vw,72px);align-items:center;padding:clamp(28px,6vw,64px);border-radius:28px;background:#071126;color:#fff}.pickla-mail__eyebrow{margin:0 0 12px;color:#32efa0;font-size:12px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.pickla-mail h2{max-width:680px;margin:0 0 16px;font-size:clamp(32px,5vw,58px);line-height:1;letter-spacing:-.04em}.pickla-mail__copy>p:last-child{margin:0;color:#bdc8da;line-height:1.6}.pickla-mail__label{display:block;margin-bottom:8px;font-size:13px;font-weight:800}.pickla-mail__row{display:flex;gap:10px}.pickla-mail__row input{min-width:0;flex:1;min-height:54px;padding:0 16px;border:2px solid transparent;border-radius:16px;background:#fff;color:#071126;font:inherit}.pickla-mail__row input:focus{outline:3px solid #32efa0;outline-offset:2px}.pickla-mail__row button{min-height:54px;padding:0 20px;border:0;border-radius:16px;background:#f43278;color:#071126;font:inherit;font-weight:900;cursor:pointer}.pickla-mail__row button:focus-visible,.pickla-mail__notice a:focus-visible{outline:3px solid #32efa0;outline-offset:3px}.pickla-mail__row button:disabled{cursor:wait;opacity:.7}.pickla-mail__consent{display:flex;gap:10px;margin-top:14px;color:#fff;font-size:13px;font-weight:750;line-height:1.45}.pickla-mail__consent input{width:18px;height:18px;margin:1px 0 0;accent-color:#f43278}.pickla-mail__notice{margin:8px 0 0 28px;color:#bdc8da;font-size:11px;line-height:1.5}.pickla-mail__notice a{color:#fff;text-underline-offset:3px}.pickla-mail__status{min-height:24px;margin:12px 0 0;color:#dbe3f1;font-size:13px}.pickla-mail__status[data-state=success]{color:#32efa0;font-weight:800}.pickla-mail__status[data-state=error]{color:#ff9dbf;font-weight:800}.pickla-mail__trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}@media(max-width:760px){.pickla-mail{grid-template-columns:1fr;padding:28px 20px}.pickla-mail__row{flex-direction:column}.pickla-mail__row button{width:100%}}@media(prefers-reduced-motion:reduce){.pickla-mail *{scroll-behavior:auto}}
    </style>
  </section>
  ${renderSignupScript(source, endpoint)}`;
}

/**
 * Standalone /join capture. It deliberately shares the exact same-origin
 * endpoint, consent payload, success state, and abuse-control boundary as the
 * embedded Public Web signup above.
 */
export function renderPicklaMailJoinSignup({
  source = 'public_web_root',
  endpoint = '/mail/subscribe',
}: {
  source?: PicklaMailSignupSource;
  endpoint?: string;
} = {}) {
  return `<section class="join-signup" data-pickla-mail-signup aria-labelledby="join-title">
    <div class="join-signup__editorial">
      <p class="join-signup__edition">Pickla · News &amp; community</p>
      <h1 id="join-title">STAY IN<br>THE PICKLA<br>LOOP<span aria-hidden="true">.</span></h1>
      <p class="join-signup__dek">Events. People. Things we're building.<br>And occasionally something worth reading.</p>
    </div>
    <div class="join-signup__capture">
      <p class="join-signup__number" aria-hidden="true">01 / JOIN</p>
      <form class="join-signup__form" novalidate>
        <label class="join-signup__label" for="pickla-join-email">Your email</label>
        <input id="pickla-join-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="320" required aria-describedby="pickla-join-consent pickla-join-status">
        <div class="join-signup__trap" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
        <label class="join-signup__consent" id="pickla-join-consent">
          <input name="consent" type="checkbox" required>
          <span>Yes, send me Pickla news &amp; community.</span>
        </label>
        <button type="submit">JOIN PICKLA <span aria-hidden="true">→</span></button>
        <p class="join-signup__status" id="pickla-join-status" role="status" aria-live="polite"></p>
      </form>
      <div class="join-signup__fine-print">
        <p>No spam. Leave whenever you want.</p>
        <p>For adults 18+. Communication concerning children is handled by a parent or guardian. See our <a href="/privacy">privacy policy</a>.</p>
      </div>
    </div>
  </section>
  ${renderSignupScript(source, endpoint)}`;
}
