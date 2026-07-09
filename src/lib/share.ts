type ShareOrCopyInput = {
  title?: string;
  text?: string;
  url?: string;
  copyText?: string;
};

function copyWithFallback(value: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}

export async function shareOrCopy({ title, text, url, copyText }: ShareOrCopyInput) {
  const fallbackText = copyText || [text, url].filter(Boolean).join("\n") || url || "";

  try {
    if (navigator.share && (title || text || url)) {
      await navigator.share({ title, text, url });
      return "shared";
    }
  } catch {
    // Safari/iOS can throw platform-specific share errors. We always fall back
    // to copying so users never see raw platform errors.
  }

  await copyWithFallback(fallbackText);
  return "copied";
}
