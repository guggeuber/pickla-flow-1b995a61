import { PUBLIC_WEB_API_ORIGIN } from './registry';

export type PicklaMailSignupSource = 'public_web' | 'public_web_paper' | 'event_editorial';

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

/**
 * Reusable, dependency-free Public Web capture block. It is intentionally not
 * mounted by renderPublicWebPage in V1; placement remains an editorial choice.
 */
export function renderPicklaMailSignup({
  source = 'public_web',
  apiOrigin = PUBLIC_WEB_API_ORIGIN,
}: {
  source?: PicklaMailSignupSource;
  apiOrigin?: string;
} = {}) {
  const endpoint = `${apiOrigin.replace(/\/$/, '')}/api-communications/subscribe`;
  return `<section class="pickla-mail" data-pickla-mail-signup>
    <div class="pickla-mail__copy">
      <p class="pickla-mail__eyebrow">Pickla Paper</p>
      <h2>Sport, människor &amp; kultur från Pickla och bortom.</h2>
      <p>Få Pickla news &amp; community i inkorgen. Du kan avsluta när du vill.</p>
    </div>
    <form class="pickla-mail__form" novalidate>
      <label class="pickla-mail__label" for="pickla-mail-email">E-postadress</label>
      <div class="pickla-mail__row">
        <input id="pickla-mail-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="320" required aria-describedby="pickla-mail-consent pickla-mail-status">
        <button type="submit">Gå med <span aria-hidden="true">→</span></button>
      </div>
      <div class="pickla-mail__trap" aria-hidden="true"><label>Webbplats<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
      <label class="pickla-mail__consent" id="pickla-mail-consent">
        <input name="consent" type="checkbox" required>
        <span>Ja, jag vill få Pickla news &amp; community via e-post. Jag kan avsluta när som helst. Läs vår <a href="/privacy">integritetspolicy</a>.</span>
      </label>
      <p class="pickla-mail__status" id="pickla-mail-status" role="status" aria-live="polite"></p>
    </form>
    <style>
      .pickla-mail{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.8fr);gap:clamp(28px,6vw,72px);align-items:center;padding:clamp(28px,6vw,64px);border-radius:28px;background:#071126;color:#fff}.pickla-mail__eyebrow{margin:0 0 12px;color:#32efa0;font-size:12px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.pickla-mail h2{max-width:680px;margin:0 0 16px;font-size:clamp(32px,5vw,58px);line-height:1;letter-spacing:-.04em}.pickla-mail__copy>p:last-child{margin:0;color:#bdc8da;line-height:1.6}.pickla-mail__label{display:block;margin-bottom:8px;font-size:13px;font-weight:800}.pickla-mail__row{display:flex;gap:10px}.pickla-mail__row input{min-width:0;flex:1;min-height:54px;padding:0 16px;border:2px solid transparent;border-radius:16px;background:#fff;color:#071126;font:inherit}.pickla-mail__row input:focus{outline:3px solid #32efa0;outline-offset:2px}.pickla-mail__row button{min-height:54px;padding:0 20px;border:0;border-radius:16px;background:#f43278;color:#071126;font:inherit;font-weight:900;cursor:pointer}.pickla-mail__row button:focus-visible,.pickla-mail__consent a:focus-visible{outline:3px solid #32efa0;outline-offset:3px}.pickla-mail__row button:disabled{cursor:wait;opacity:.7}.pickla-mail__consent{display:flex;gap:10px;margin-top:14px;color:#dbe3f1;font-size:13px;line-height:1.45}.pickla-mail__consent input{width:18px;height:18px;margin:1px 0 0;accent-color:#f43278}.pickla-mail__consent a{color:#fff;text-underline-offset:3px}.pickla-mail__status{min-height:24px;margin:12px 0 0;color:#dbe3f1;font-size:13px}.pickla-mail__status[data-state=success]{color:#32efa0;font-weight:800}.pickla-mail__status[data-state=error]{color:#ff9dbf;font-weight:800}.pickla-mail__trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}@media(max-width:760px){.pickla-mail{grid-template-columns:1fr;padding:28px 20px}.pickla-mail__row{flex-direction:column}.pickla-mail__row button{width:100%}}@media(prefers-reduced-motion:reduce){.pickla-mail *{scroll-behavior:auto}}
    </style>
  </section>
  <script>(function(){var script=document.currentScript;var root=script&&script.previousElementSibling;if(!root||!root.matches("[data-pickla-mail-signup]"))return;var form=root.querySelector("form");var status=root.querySelector("[role=status]");var button=form.querySelector("button");form.addEventListener("submit",async function(event){event.preventDefault();status.textContent="";status.removeAttribute("data-state");if(!form.reportValidity())return;button.disabled=true;var data=new FormData(form);try{var response=await fetch(${JSON.stringify(endpoint)},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:data.get("email"),consent:data.get("consent")==="on",website:data.get("website"),source:${JSON.stringify(escapeHtml(source))}})});if(!response.ok)throw new Error("request_failed");form.reset();status.dataset.state="success";status.textContent="Du är med. Välkommen till Pickla."}catch(error){status.dataset.state="error";status.textContent="Det gick inte just nu. Försök igen om en stund."}finally{button.disabled=false}})})();</script>`;
}
